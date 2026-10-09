'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const MBTILES_PATH = path.join(ROOT, 'ayagoz.mbtiles');
const SEARCH_PATH = path.join(ROOT, 'addresses.json');
const VERSION = 'ayagoz-v3';

function reply(res, code, type, content, cache = 'no-store') {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': cache,
    'Access-Control-Allow-Origin': '*'
  });
  res.end(content);
}

const roadsFilter = list => ['in', ['get', 'class'], ['literal', list]];
const lineWidth = (low, high, extra) => ['interpolate', ['linear'], ['zoom'], 10, low, 14, high, 18, extra];
const labelPaint = (color, haloWidth = 1.7) => ({
  'text-color': color, 'text-halo-color': '#fff', 'text-halo-width': haloWidth
});

function roadLayer(id, classes, color, casing, low, mid, high) {
  return [
    { id: id + '-edge', type: 'line', source: 'ayagoz', 'source-layer': 'roads',
      filter: roadsFilter(classes),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': casing, 'line-width': lineWidth(low + 1.5, mid + 2.4, high + 3) } },
    { id, type: 'line', source: 'ayagoz', 'source-layer': 'roads',
      filter: roadsFilter(classes),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': color, 'line-width': lineWidth(low, mid, high) } }
  ];
}

function style(origin, minzoom, maxzoom) {
  return {
    version: 8,
    name: 'Аягоз · Карта для такси',
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      ayagoz: {
        type: 'vector',
        tiles: [origin + '/tiles/{z}/{x}/{y}.pbf?v=' + VERSION],
        minzoom, maxzoom,
        bounds: [80.30, 47.90, 80.55, 48.05],
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>'
      }
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#f5f6f3' } },
      { id: 'parks', type: 'fill', source: 'ayagoz', 'source-layer': 'landuse',
        paint: { 'fill-color': '#dcebcf', 'fill-opacity': 0.85 } },
      { id: 'water', type: 'fill', source: 'ayagoz', 'source-layer': 'water',
        paint: { 'fill-color': '#afdbea', 'fill-outline-color': '#8bc6dc' } },
      { id: 'waterways', type: 'line', source: 'ayagoz', 'source-layer': 'waterways',
        paint: { 'line-color': '#8bc6dc', 'line-width': lineWidth(0.6, 2, 4) } },
      { id: 'railways', type: 'line', source: 'ayagoz', 'source-layer': 'railways',
        paint: { 'line-color': '#8e9295', 'line-dasharray': [2, 2], 'line-width': 2 } },
      ...roadLayer('paths',
        ['footway', 'cycleway', 'path', 'pedestrian', 'steps', 'track'],
        '#f3f0e9', '#dedbd4', 0.25, 1.2, 2.4),
      ...roadLayer('service-roads',
        ['service', 'living_street', 'residential', 'unclassified', 'road'],
        '#ffffff', '#c9cbc9', 0.6, 3.6, 10),
      ...roadLayer('secondary-roads',
        ['tertiary', 'tertiary_link', 'secondary', 'secondary_link'],
        '#ffedbf', '#d0b777', 1.6, 5.4, 14),
      ...roadLayer('main-roads',
        ['primary', 'primary_link', 'trunk', 'trunk_link', 'motorway', 'motorway_link'],
        '#ffd18b', '#d5a666', 2.5, 7.2, 17),
      { id: 'buildings', type: 'fill', source: 'ayagoz', 'source-layer': 'buildings',
        minzoom: 13,
        paint: { 'fill-color': '#e2ddd4', 'fill-outline-color': '#c9c1b5',
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 16, 1] } },
      { id: 'poi-dots', type: 'circle', source: 'ayagoz', 'source-layer': 'pois', minzoom: 15,
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 2.5, 18, 4],
          'circle-color': '#528c90', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.2 } },
      { id: 'road-names', type: 'symbol', source: 'ayagoz', 'source-layer': 'roads', minzoom: 13,
        filter: ['any', ['has', 'name'], ['has', 'name_ru'], ['has', 'ref']],
        layout: { 'symbol-placement': 'line', 'symbol-spacing': 220,
          'text-field': ['coalesce', ['get', 'name_ru'], ['get', 'name'], ['get', 'ref'], ''],
          'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 17, 13],
          'text-max-width': 10, 'text-rotation-alignment': 'map' },
        paint: labelPaint('#58616b', 1.8) },
      { id: 'place-names', type: 'symbol', source: 'ayagoz', 'source-layer': 'places',
        layout: { 'text-field': ['coalesce', ['get', 'name_ru'], ['get', 'name'], ''],
          'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 10, 13, 15, 17],
          'text-letter-spacing': 0.03 },
        paint: labelPaint('#324f59', 2.2) },
      { id: 'poi-names', type: 'symbol', source: 'ayagoz', 'source-layer': 'pois',
        minzoom: 16, filter: ['has', 'name'],
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Regular'],
          'text-size': 10, 'text-offset': [0, 1], 'text-anchor': 'top',
          'text-max-width': 10 },
        paint: labelPaint('#477679', 1.6) },
      { id: 'house-numbers', type: 'symbol', source: 'ayagoz', 'source-layer': 'addresses',
        minzoom: 16, filter: ['has', 'housenumber'],
        layout: { 'text-field': ['get', 'housenumber'], 'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 16, 10, 18, 13],
          'text-allow-overlap': false, 'text-padding': 2 },
        paint: labelPaint('#504b43', 1.7) }
    ]
  };
}

const HTML = String.raw`<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Аягоз — карта такси</title>
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet">
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<style>
*{box-sizing:border-box}html,body,#map{height:100%;width:100%;margin:0;font-family:system-ui,-apple-system,Arial,sans-serif}
#map{position:absolute;inset:0}
.panel{position:absolute;left:14px;top:14px;width:min(365px,calc(100% - 80px));z-index:5;background:white;border-radius:14px;box-shadow:0 5px 24px #0003;padding:12px}
.brand{font-size:15px;font-weight:750;display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;color:#173a45}
.sub{font-size:11px;color:#66747d;font-weight:400}
.search-wrap{display:flex;gap:6px}
#q{width:100%;font-size:14px;border-radius:9px;padding:11px;border:1px solid #d4dddf;outline:none}
#q:focus{border-color:#148d93;box-shadow:0 0 0 2px #148d9322}
button{background:#eef6f7;color:#175c65;border:0;border-radius:8px;padding:9px 10px;cursor:pointer;font-weight:650}
button:hover{background:#dcecee}button.active{background:#137f87;color:#fff}
.buttons{display:flex;gap:7px;margin-top:8px;flex-wrap:wrap}
.buttons button{font-size:12px;flex:1;min-width:100px}
#results{max-height:230px;overflow-y:auto;margin-top:5px}
.result{display:block;width:100%;text-align:left;background:transparent;border-bottom:1px solid #edf0f1;border-radius:0;padding:9px 5px;font-size:13px;color:#263e43}
.result small{display:block;color:#728189;font-size:11px;margin-top:3px}
#note{font-size:11px;color:#586c72;margin-top:8px;line-height:1.4}
#notice{position:absolute;z-index:5;left:50%;bottom:24px;transform:translateX(-50%);max-width:92%;background:#153e46;color:white;border-radius:10px;padding:10px 15px;font-size:12px;text-align:center;display:none}
.legend{position:absolute;bottom:27px;left:14px;z-index:3;background:#fffffff0;padding:7px 10px;border-radius:8px;font-size:11px;color:#5b656d;box-shadow:0 1px 6px #0002}
@media(max-width:560px){.panel{left:8px;top:8px;padding:10px;width:calc(100% - 67px)}.legend{bottom:29px;left:8px;font-size:10px}}
</style></head><body>
<div id="map"></div>
<div class="panel">
  <div class="brand"><span>🚕 Карта Аягоза</span><span class="sub">OpenStreetMap</span></div>
  <div class="search-wrap"><input id="q" autocomplete="off" placeholder="Улица, дом: Абая 10" aria-label="Поиск адреса"><button id="clear" title="Очистить поиск">✕</button></div>
  <div id="results"></div>
  <div class="buttons"><button id="pickup">📍 Откуда</button><button id="dropoff">🏁 Куда</button><button id="locate">◎ Моё место</button></div>
  <div id="note">Приблизь карту: номера домов появляются с масштаба 16. Нажми дом для подробностей.</div>
</div>
<div class="legend">🟠 главные дороги · ⚪ местные · 🟩 парки · 🔵 вода</div>
<div id="notice" role="status"></div>
<script>
(function(){
'use strict';
var map = new maplibregl.Map({container:'map',style:'/style.json',center:[80.4366,47.96512],zoom:14,maxZoom:19,minZoom:10,maxBounds:[[80.29,47.89],[80.56,48.06]]});
map.addControl(new maplibregl.NavigationControl({showCompass:false}), 'top-right');
var search = document.getElementById('q');
var results = document.getElementById('results');
var pickupButton = document.getElementById('pickup');
var dropoffButton = document.getElementById('dropoff');
var searchItems = [];
var selectedMode = '';
var markers = {};
var messageTimer;
function notice(s){var el=document.getElementById('notice');el.textContent=s;el.style.display='block';clearTimeout(messageTimer);messageTimer=setTimeout(function(){el.style.display='none'},4500)}
function setMode(mode){selectedMode=selectedMode===mode?'':mode;pickupButton.classList.toggle('active',selectedMode==='pickup');dropoffButton.classList.toggle('active',selectedMode==='dropoff');if(selectedMode)notice('Нажми на карту, чтобы выбрать '+(selectedMode==='pickup'?'место посадки':'место назначения'));}
function choosePoint(coordinates, mode){if(markers[mode])markers[mode].remove();var el=document.createElement('div');el.style.cssText='width:24px;height:24px;background:'+(mode==='pickup'?'#128f7f':'#e87343')+';border:3px solid white;border-radius:50%;box-shadow:0 2px 7px #0008';markers[mode]=new maplibregl.Marker({element:el}).setLngLat(coordinates).addTo(map);notice((mode==='pickup'?'Посадка':'Назначение')+' выбрано. Маршруты подключим позже.');}
pickupButton.addEventListener('click',function(){setMode('pickup')});
dropoffButton.addEventListener('click',function(){setMode('dropoff')});
document.getElementById('locate').addEventListener('click',function(){
 if(!navigator.geolocation){notice('Геолокация недоступна в этом браузере');return;}
 navigator.geolocation.getCurrentPosition(function(pos){map.flyTo({center:[pos.coords.longitude,pos.coords.latitude],zoom:16});notice('Местоположение определено');},function(){notice('Разреши доступ к геолокации или проверь настройки устройства');},{enableHighAccuracy:true,timeout:12000});
});
map.on('click',function(e){
 if(selectedMode){choosePoint([e.lngLat.lng,e.lngLat.lat],selectedMode);setMode(selectedMode);return;}
 var features=map.queryRenderedFeatures(e.point,{layers:['house-numbers','buildings','road-names','poi-dots','poi-names']});
 if(!features.length)return;
 var properties=features[0].properties||{};
 var title=properties.name||properties.housenumber||'Объект на карте';
 var details=[];
 if(properties.street)details.push(properties.street);
 if(properties.housenumber)details.push('дом '+properties.housenumber);
 var popup=document.createElement('div');popup.style.fontFamily='Arial,sans-serif';
 var titleEl=document.createElement('strong');titleEl.textContent=title;popup.appendChild(titleEl);
 if(details.length){var detail=document.createElement('div');detail.textContent=details.join(', ');popup.appendChild(detail)}
 else if(features[0].layer.id==='buildings'){var no=document.createElement('div');no.textContent='Номер дома не указан в OSM';popup.appendChild(no)}
 new maplibregl.Popup({maxWidth:'260px'}).setLngLat(e.lngLat).setDOMContent(popup).addTo(map);
});
map.on('error',function(e){console.error('Ошибка карты:',e.error)});

function normalize(s){return String(s||'').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/(^|\s)(улица|ул\.?|проспект|пр\.?|дом|д\.?)(?=\s|$)/g,' ').replace(/[,.-]/g,' ').replace(/\s+/g,' ').trim()}
function resultKind(x){return x.kind==='address'?'Адрес':x.kind==='street'?'Улица':'Населённый пункт'}
function updateSearch(){
 var query=normalize(search.value);results.replaceChildren();if(query.length<2)return;
 var parts=query.split(' ');
 var matches=searchItems.filter(function(x){var t=normalize(x.label);return parts.every(function(p){return t.includes(p)})}).slice(0,12);
 if(!matches.length){var d=document.createElement('div');d.style.cssText='font-size:12px;color:#74848a;padding:10px 2px';d.textContent='В базе нет такого адреса. Попробуй название улицы.';results.appendChild(d);return;}
 matches.forEach(function(x){var b=document.createElement('button');b.className='result';b.textContent=x.label;var small=document.createElement('small');small.textContent=resultKind(x);b.appendChild(small);b.addEventListener('click',function(){map.flyTo({center:[x.lon,x.lat],zoom:x.kind==='address'?17:15});search.value=x.label;results.replaceChildren();new maplibregl.Popup().setLngLat([x.lon,x.lat]).setText(x.label).addTo(map)});results.appendChild(b)})
}
search.addEventListener('input',updateSearch);
document.getElementById('clear').addEventListener('click',function(){search.value='';results.replaceChildren();search.focus()});
fetch('/search-index.json').then(function(r){if(!r.ok)throw Error('no index');return r.json()}).then(function(data){searchItems=Array.isArray(data)?data:[];document.getElementById('note').textContent='Поиск: '+searchItems.length+' адресов и улиц. Номера домов видны с масштаба 16, если они есть в OSM.';}).catch(function(){document.getElementById('note').textContent='Поиск пока не настроен: добавь addresses.json. Номера домов отображаются, если они указаны в OSM.'});
})();
</script></body></html>`;

async function main() {
  if (!fs.existsSync(MBTILES_PATH)) throw new Error('Нет ayagoz.mbtiles рядом с server.js');
  const SQL = await initSqlJs({locateFile: file => require.resolve('sql.js/dist/' + file)});
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(MBTILES_PATH)));
  const metadata = {};
  const rows = db.exec('SELECT name, value FROM metadata');
  for (const row of (rows[0]?.values || [])) metadata[row[0]] = row[1];
  const minzoom = Number(metadata.minzoom || 10), maxzoom = Number(metadata.maxzoom || 14);
  const count = db.exec('SELECT count(*) FROM tiles')[0]?.values[0]?.[0] || 0;
  const index = fs.existsSync(SEARCH_PATH) ? fs.readFileSync(SEARCH_PATH) : Buffer.from('[]');
  console.log('Карта загружена:', count, 'тайлов; zoom', minzoom, '-', maxzoom, '; индекс:', index.length, 'байт');
  http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/') return reply(res, 200, 'text/html; charset=utf-8', HTML);
      if (url.pathname === '/health') return reply(res, 200, 'application/json; charset=utf-8', JSON.stringify({status:'ok',city:'Ayagoz',tiles:count,minzoom,maxzoom,index:fs.existsSync(SEARCH_PATH)}));
      if (url.pathname === '/search-index.json') return reply(res, 200, 'application/json; charset=utf-8', index, 'public,max-age=300');
      if (url.pathname === '/style.json') {
        const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        const origin = protocol + '://' + req.headers.host;
        return reply(res, 200, 'application/json; charset=utf-8', JSON.stringify(style(origin,minzoom,maxzoom)));
      }
      const m = /^\/tiles\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(url.pathname);
      if (m) {
        const [z,x,y] = m.slice(1).map(Number);
        if (z < minzoom || z > maxzoom || x < 0 || y < 0 || x >= 2**z || y >= 2**z) return reply(res,404,'text/plain','Not found');
        const stmt = db.prepare('SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?');
        let tile;
        try { stmt.bind([z,x,2**z-1-y]); if (stmt.step()) tile = stmt.getAsObject().tile_data; }
        finally { stmt.free(); }
        if (!tile) return reply(res,204,'text/plain','');
        res.writeHead(200, {'Content-Type':'application/vnd.mapbox-vector-tile','Content-Encoding':'gzip','Cache-Control':'public,max-age=300','Access-Control-Allow-Origin':'*'});
        return res.end(Buffer.from(tile));
      }
      return reply(res,404,'text/plain','Not found');
    } catch (error) { console.error(error); return reply(res,500,'text/plain','Server error'); }
  }).listen(PORT,'0.0.0.0',() => console.log('Ayagoz Taxi Map v2 · порт', PORT));
}
main().catch(error=>{console.error(error);process.exit(1)});
