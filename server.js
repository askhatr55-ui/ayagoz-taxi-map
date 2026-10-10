'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const initSqlJs = require('sql.js');
const ROOT = __dirname;
const SERVER_VERSION = 'ayagoz-map-3.1.0';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');

async function start(options = {}) {
  const root = options.root || ROOT;
  const mapFile = options.mapFile || process.env.MBTILES_FILE || 'ayagoz-v3.mbtiles';
  const filename = path.resolve(root, mapFile);
  const bytes = fs.readFileSync(filename);
  const mapHash = hash(bytes);
  const version = mapHash.slice(0, 20);
  const SQL = await initSqlJs({ locateFile: file => require.resolve('sql.js/dist/' + file) });
  const db = new SQL.Database(new Uint8Array(bytes));
  const rows = sql => db.exec(sql)[0]?.values || [];
  if (rows('PRAGMA integrity_check')[0]?.[0] !== 'ok') throw Error('MBTiles: SQLite integrity check failed');
  const metadata = Object.fromEntries(rows('SELECT name,value FROM metadata'));
  if (metadata.format !== 'pbf') throw Error('MBTiles must contain vector PBF tiles');
  const perZoom = rows('SELECT zoom_level,count(*) FROM tiles GROUP BY zoom_level ORDER BY zoom_level')
    .map(([zoom, tiles]) => ({zoom, tiles}));
  if (!perZoom.length) throw Error('MBTiles contains no tiles');
  const minzoom = perZoom[0].zoom;
  const maxzoom = perZoom.at(-1).zoom;
  if (minzoom < 0 || maxzoom > 22) throw Error('Invalid MBTiles zoom range');
  const bounds = String(metadata.bounds || '').split(',').map(Number);
  if (bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[0] >= bounds[2] || bounds[1] >= bounds[3])
    throw Error('Valid MBTiles bounds are required');
  const layers = JSON.parse(metadata.json || '{"vector_layers":[]}').vector_layers || [];
  const layerIds = new Set(layers.map(l => l.id));
  const stmt = db.prepare('SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?');
  const scheme = metadata.scheme || 'tms';
  if (!['tms', 'xyz'].includes(scheme)) throw Error('Unsupported MBTiles scheme');
  const getTile = (z,x,y) => {
    stmt.reset(); stmt.bind([z,x,scheme === 'tms' ? 2 ** z - 1 - y : y]);
    return stmt.step() ? Buffer.from(stmt.getAsObject().tile_data) : null;
  };
  // Validate actual stored compression before advertising readiness.
  let gzipTiles = 0, rawTiles = 0;
  for (const [data] of rows('SELECT tile_data FROM tiles')) {
    const b = Buffer.from(data);
    if (b[0] === 31 && b[1] === 139) { zlib.gunzipSync(b); gzipTiles++; }
    else { if (!b.length) throw Error('Empty tile blob'); rawTiles++; }
  }
  const styleTemplate = JSON.parse(fs.readFileSync(path.join(root,'style.json'),'utf8'));
  const html = fs.readFileSync(path.join(root,'index.html'));
  const warnings = [];
  let search = [];
  const addresses = path.join(root,'addresses.json');
  if (fs.existsSync(addresses)) {
    try {
      const candidate = JSON.parse(fs.readFileSync(addresses,'utf8'));
      if (!Array.isArray(candidate)) throw Error('Expected array');
      search = candidate.filter(p => typeof p.label === 'string' && p.label.trim() &&
        Number.isFinite(p.lon) && Number.isFinite(p.lat) &&
        p.lon >= bounds[0] && p.lon <= bounds[2] && p.lat >= bounds[1] && p.lat <= bounds[3]);
      if (search.length !== candidate.length) warnings.push('Invalid search entries skipped');
    } catch(e) { warnings.push('addresses.json: ' + e.message); }
  } else warnings.push('Search index absent; map remains available');
  const roadsLayer = layers.find(l=>l.id === 'roads');
  const displayMinZoom = Math.max(minzoom, roadsLayer?.minzoom ?? minzoom);
  const commit = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || null;
  const sourceHash = hash(Buffer.concat([fs.readFileSync(__filename), html, Buffer.from(JSON.stringify(styleTemplate))]));
  const counts = {served:0, missing:0, errors:0};
  const recentMissing = [];
  const norm = s => String(s || '').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[,.-]/g,' ').replace(/\s+/g,' ').trim();
  const searchable = search.map(p=>({p,text:norm(p.label)}));
  const server = http.createServer((req,res)=>{
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Map-Version',version);
    res.setHeader('X-Server-Version',SERVER_VERSION);
    if (commit) res.setHeader('X-Deploy-Commit',commit);
    const send = (status,type,body,headers={})=>{
      res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store',...headers});
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    const json = (status,data)=>send(status,'application/json; charset=utf-8',JSON.stringify(data));
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204,{'Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'If-None-Match'});res.end();return;
      }
      if (!['GET','HEAD'].includes(req.method)) { send(405,'text/plain','Method not allowed',{'Allow':'GET, HEAD, OPTIONS'});return; }
      const url = new URL(req.url,'http://localhost');
      if (url.pathname === '/health') {
        json(200,{status:'ok',serverVersion:SERVER_VERSION,commit,sourceHash,mapFile:path.basename(filename),
          mapSha256:mapHash,mapVersion:version,mapBytes:bytes.length,minzoom,maxzoom,displayMinZoom,bounds,scheme,
          tiles:perZoom.reduce((a,p)=>a+p.tiles,0),perZoom,layers:[...layerIds],compression:{gzipTiles,rawTiles},
          searchIndex:search.length > 0,searchEntries:search.length,warnings,...counts,recentMissing,
          uptimeSeconds:Math.round(process.uptime()),rssBytes:process.memoryUsage().rss});return;
      }
      if (url.pathname === '/style.json') {
        const style = structuredClone(styleTemplate);
        // Relative TileJSON URLs resolve against the current style URL; no proxy Host trust needed.
        style.sources = {ayagoz:{type:'vector',tiles:[`/tiles/{z}/{x}/{y}.pbf?v=${version}`],
          minzoom:displayMinZoom,maxzoom,bounds,scheme:'xyz',attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'}};
        style.layers = style.layers.filter(l=>!l['source-layer'] || layerIds.has(l['source-layer']));
        json(200,style);return;
      }
      if (url.pathname === '/search-index.json') { json(200,search);return; }
      if (url.pathname === '/search') {
        const q = norm((url.searchParams.get('q') || '').slice(0,160));
        const words = q.split(' ');
        json(200,{available:search.length > 0,results:q.length < 2 ? [] : searchable.filter(r=>words.every(w=>r.text.includes(w))).slice(0,12).map(r=>r.p)});return;
      }
      const match = /^\/tiles\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(url.pathname);
      if (match) {
        const [z,x,y] = match.slice(1).map(Number);
        if (!Number.isSafeInteger(z) || z<minzoom || z>maxzoom || !Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x>=2**z || y>=2**z) {
          send(404,'text/plain','Tile outside supported range');return;
        }
        const requestedVersion = url.searchParams.get('v');
        if (requestedVersion && requestedVersion !== version) {
          send(409,'text/plain','Map version changed; reload /style.json');return;
        }
        const b = getTile(z,x,y);
        if (!b) {
          counts.missing++;recentMissing.push({z,x,y});if(recentMissing.length>20)recentMissing.shift();
          // Empty MVT is valid protobuf. No coarse parent tile is substituted for a missing child.
          send(200,'application/vnd.mapbox-vector-tile',Buffer.alloc(0),{'Cache-Control':'public, max-age=300','X-Tile-Empty':'1'});return;
        }
        const etag = '"' + version + '-' + z + '-' + x + '-' + y + '"';
        const headers = {'ETag':etag,'Cache-Control':requestedVersion === version ? 'public, max-age=31536000, immutable' : 'public, max-age=300'};
        if (req.headers['if-none-match'] === etag) { res.writeHead(304,headers);res.end();return; }
        if (b[0] === 31 && b[1] === 139) headers['Content-Encoding']='gzip';
        counts.served++;send(200,'application/vnd.mapbox-vector-tile',b,headers);return;
      }
      if (url.pathname === '/') { send(200,'text/html; charset=utf-8',html);return; }
      if (url.pathname === '/favicon.ico') {res.writeHead(204);res.end();return;}
      send(404,'text/plain','Not found');
    } catch(e) {counts.errors++;console.error(e);if(!res.headersSent)json(500,{error:'Map request failed; see server logs'});else res.end();}
  });
  server.on('close',()=>{stmt.free();db.close();});
  const port = options.port ?? Number(process.env.PORT || 3000);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,options.host || '0.0.0.0',resolve);});
  console.log(`${SERVER_VERSION} map=${path.basename(filename)} sha256=${mapHash} commit=${commit || 'local/unknown'} port=${server.address().port}`);
  return server;
}
if (require.main === module) start().catch(e=>{console.error('Startup failed:',e.message);process.exitCode=1;});
module.exports = {start};
