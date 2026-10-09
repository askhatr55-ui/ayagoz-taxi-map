
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

// Используем выбранный файл карты v3.
const MAP_PATH = path.join(ROOT, 'ayagoz-v3.mbtiles');

const INDEX_PATH = path.join(ROOT, 'addresses.json');
const CITY_BOUNDS = [80.30, 47.90, 80.55, 48.05];

function respond(res, status, type, body, cache = 'no-store') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': cache,
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function roadWidth(a, b, c, d) {
  return [
    'interpolate', ['linear'], ['zoom'],
    10, a, 14, b, 16, c, 19, d
  ];
}

function makeStyle(origin, minzoom, maxzoom, version, available, bounds) {
  const layers = [];
  const source = 'ayagoz';

  // Добавляем слой только если он есть в MBTiles.
  const add = (layerName, layer) => {
    if (available.has(layerName)) layers.push(layer);
  };

  const textPaint = color => ({
    'text-color': color,
    'text-halo-color': '#ffffff',
    'text-halo-width': 1.8
  });

  layers.push({
    id: 'background',
    type: 'background',
    paint: {
      'background-color': '#f4f5f1'
    }
  });

  // Парки и территории.
  add('landuse', {
    id: 'landuse',
    type: 'fill',
    source,
    'source-layer': 'landuse',
    paint: {
      'fill-color': [
        'match', ['get', 'class'],
        ['industrial', 'commercial', 'retail'], '#ece9e4',
        ['cemetery'], '#dbe3d1',
        '#d8eacb'
      ],
      'fill-opacity': 0.85
    }
  });

  add('water', {
    id: 'water',
    type: 'fill',
    source,
    'source-layer': 'water',
    paint: {
      'fill-color': '#a9d8ed'
    }
  });

  add('waterways', {
    id: 'waterways',
    type: 'line',
    source,
    'source-layer': 'waterways',
    paint: {
      'line-color': '#80c2e2',
      'line-width': roadWidth(0.5, 1.5, 2.6, 4)
    }
  });

  // Здания рисуем ПЕРЕД дорогами.
  // Так контуры зданий не будут перекрывать улицы.
  add('buildings', {
    id: 'buildings',
    type: 'fill',
    source,
    'source-layer': 'buildings',
    minzoom: 13,
    paint: {
      'fill-color': '#ded9d0',
      'fill-outline-color': '#bfb9ae',
      'fill-opacity': [
        'interpolate', ['linear'], ['zoom'],
        13, 0.65, 16, 1
      ]
    }
  });

  add('railways', {
    id: 'railways',
    type: 'line',
    source,
    'source-layer': 'railways',
    paint: {
      'line-color': '#8d8d91',
      'line-width': roadWidth(1, 2, 2.5, 4),
      'line-dasharray': [3, 2]
    }
  });

  const roadFilter = classes => [
    'in', ['get', 'class'], ['literal', classes]
  ];

  function roads(id, classes, fill, edge, widths) {
    add('roads', {
      id: id + '-outline',
      type: 'line',
      source,
      'source-layer': 'roads',
      filter: roadFilter(classes),
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': edge,
        'line-width': roadWidth(...widths.map(w => w + 2))
      }
    });

    add('roads', {
      id,
      type: 'line',
      source,
      'source-layer': 'roads',
      filter: roadFilter(classes),
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': fill,
        'line-width': roadWidth(...widths)
      }
    });
  }

  // Все дороги: даже неизвестные типы останутся видимыми.
  add('roads', {
    id: 'all-roads',
    type: 'line',
    source,
    'source-layer': 'roads',
    paint: {
      'line-color': '#c7c9c7',
      'line-width': roadWidth(0.6, 1.6, 2.8, 5)
    }
  });

  roads(
    'paths',
    ['footway', 'cycleway', 'path', 'pedestrian',
     'steps', 'track', 'bridleway'],
    '#eeeadd', '#d2d0c8',
    [0.4, 1.1, 1.8, 3.4]
  );

  roads(
    'streets',
    ['service', 'living_street', 'residential',
     'unclassified', 'road'],
    '#ffffff', '#c9c9c5',
    [0.8, 3.5, 5.3, 10]
  );

  roads(
    'secondary-roads',
    ['tertiary', 'tertiary_link',
     'secondary', 'secondary_link'],
    '#ffe7ad', '#d1b77c',
    [1.5, 5, 7, 14]
  );

  roads(
    'main-roads',
    ['primary', 'primary_link', 'trunk', 'trunk_link',
     'motorway', 'motorway_link'],
    '#ffd08c', '#cda369',
    [2, 6.5, 9, 18]
  );

  // Цветные обозначения организаций.
  const poiType = [
    'coalesce',
    ['get', 'amenity'],
    ['get', 'shop'],
    ['get', 'healthcare'],
    ['get', 'industrial'],
    ['get', 'office'],
    ['get', 'tourism'],
    ['get', 'leisure'],
    'other'
  ];

  add('pois', {
    id: 'poi-dots',
    type: 'circle',
    source,
    'source-layer': 'pois',
    minzoom: 14,
    paint: {
      'circle-color': [
        'match', poiType,
        ['school', 'kindergarten', 'college',
         'university', 'library'], '#3b7fd4',
        ['hospital', 'clinic', 'doctors',
         'dentist', 'pharmacy'], '#db5c67',
        ['fuel', 'car_wash', 'parking',
         'bus_station', 'taxi'], '#b183cf',
        ['park', 'sports_centre',
         'stadium', 'playground'], '#4b9b61',
        ['industrial', 'works', 'warehouse'], '#897d70',
        '#da954f'
      ],
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        14, 2, 16, 4, 19, 6
      ],
      'circle-stroke-width': 1.2,
      'circle-stroke-color': '#ffffff'
    }
  });

  // Названия улиц.
  add('roads', {
    id: 'road-names',
    type: 'symbol',
    source,
    'source-layer': 'roads',
    minzoom: 13,
    filter: [
      'any',
      ['has', 'name'],
      ['has', 'name_ru'],
      ['has', 'name_kk'],
      ['has', 'ref']
    ],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 220,
      'text-field': [
        'coalesce',
        ['get', 'name_ru'],
        ['get', 'name'],
        ['get', 'name_kk'],
        ['get', 'ref'],
        ''
      ],
      'text-font': ['Open Sans Regular'],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        13, 10, 16, 13, 19, 15
      ]
    },
    paint: textPaint('#52606a')
  });

  // Названия населённых пунктов.
  add('places', {
    id: 'place-names',
    type: 'symbol',
    source,
    'source-layer': 'places',
    layout: {
      'text-field': [
        'coalesce',
        ['get', 'name_ru'],
        ['get', 'name'],
        ['get', 'name_kk'],
        ''
      ],
      'text-font': ['Open Sans Regular'],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        10, 13, 15, 17, 18, 20
      ]
    },
    paint: textPaint('#325266')
  });

  // Названия школ, магазинов, предприятий и других мест.
  add('pois', {
    id: 'poi-names',
    type: 'symbol',
    source,
    'source-layer': 'pois',
    minzoom: 15,
    filter: [
      'any',
      ['has', 'name'],
      ['has', 'name_ru'],
      ['has', 'name_kk']
    ],
    layout: {
      'text-field': [
        'coalesce',
        ['get', 'name_ru'],
        ['get', 'name'],
        ['get', 'name_kk'],
        ''
      ],
      'text-font': ['Open Sans Regular'],
      'text-size': 11,
      'text-anchor': 'top',
      'text-offset': [0, 0.8],
      'text-max-width': 12
    },
    paint: textPaint('#45545d')
  });

  // Номера домов.
  if (available.has('addresses')) {
    add('addresses', {
      id: 'house-numbers',
      type: 'symbol',
      source,
      'source-layer': 'addresses',
      minzoom: 16,
      filter: ['has', 'housenumber'],
      layout: {
        'text-field': ['get', 'housenumber'],
        'text-font': ['Open Sans Regular'],
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          16, 10, 19, 14
        ],
        'text-allow-overlap': false
      },
      paint: textPaint('#514b44')
    });
  } else {
    // Резерв для старой карты без слоя addresses.
    add('buildings', {
      id: 'house-numbers',
      type: 'symbol',
      source,
      'source-layer': 'buildings',
      minzoom: 16,
      filter: ['has', 'housenumber'],
      layout: {
        'text-field': ['get', 'housenumber'],
        'text-font': ['Open Sans Regular'],
        'text-size': 11
      },
      paint: textPaint('#514b44')
    });
  }

  return {
    version: 8,
    name: 'Аягоз — карта для такси',
    glyphs:
      'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      ayagoz: {
        type: 'vector',
        tiles: [
          origin + '/tiles/{z}/{x}/{y}.pbf?v=' + version
        ],
        minzoom,
        maxzoom,

        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
      }
    },
    layers
  };
}

// Интерфейс карты.
const HTML = String.raw`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Аягоз — карта такси</title>
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css">
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<style>
* {
  box-sizing: border-box;
}
html, body, #map {
  width: 100%;
  height: 100%;
  margin: 0;
  font-family: system-ui, Arial, sans-serif;
}
#map {
  position: absolute;
  inset: 0;
}
.panel {
  position: absolute;
  z-index: 3;
  top: 12px;
  left: 12px;
  width: min(360px, calc(100% - 78px));
  padding: 13px;
  background: white;
  border-radius: 13px;
  box-shadow: 0 3px 16px #0002;
}
.header {
  font-weight: 750;
  color: #21454c;
  margin-bottom: 9px;
}
.search {
  display: flex;
  gap: 5px;
}
.search input {
  width: 100%;
  min-width: 0;
  border: 1px solid #ccd5d8;
  border-radius: 8px;
  padding: 10px;
  font-size: 14px;
}
button {
  cursor: pointer;
  border: 0;
  border-radius: 8px;
  padding: 9px;
  background: #edf4f4;
  color: #245861;
  font-weight: 600;
}
.actions {
  display: flex;
  gap: 6px;
  margin-top: 9px;
  flex-wrap: wrap;
}
.actions button {
  flex: 1;
  min-width: 85px;
  font-size: 12px;
}
button.active {
  background: #18868d;
  color: white;
}
#results {
  max-height: 220px;
  overflow-y: auto;
}
.result {
  width: 100%;
  display: block;
  text-align: left;
  background: white;
  border-bottom: 1px solid #e5ebec;
  border-radius: 0;
}
.result small {
  display: block;
  color: #66777b;
  margin-top: 3px;
}
#info {
  color: #68797c;
  font-size: 11px;
  margin-top: 8px;
}
#status {
  position: absolute;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  z-index: 4;
  background: #1d4750;
  color: white;
  padding: 9px 14px;
  border-radius: 10px;
  font-size: 12px;
  max-width: 90%;
  text-align: center;
}
@media(max-width:500px) {
  .panel {
    top: 7px;
    left: 7px;
    width: calc(100% - 66px);
    padding: 9px;
  }
}
</style>
</head>
<body>
<div id="map"></div>

<div class="panel">
  <div class="header">🚕 Аягоз — карта такси</div>
  <div class="search">
    <input id="query" placeholder="Поиск улицы и дома" autocomplete="off">
    <button id="clear">✕</button>
  </div>
  <div id="results"></div>
  <div class="actions">
    <button id="pickup">📍 Откуда</button>
    <button id="dropoff">🏁 Куда</button>
    <button id="locate">◎ Я здесь</button>
  </div>
  <div id="info">
    Номера домов видны при приближении, если они есть в OSM.
  </div>
</div>

<div id="status">Загрузка карты…</div>

<script>
(function () {
  'use strict';

  var status = document.getElementById('status');
  var statusTimer;

  function message(text, autoHide) {
    status.textContent = text;
    status.style.display = 'block';
    clearTimeout(statusTimer);
    if (autoHide) {
      statusTimer = setTimeout(function () {
        status.style.display = 'none';
      }, 4500);
    }
  }

  if (!window.maplibregl) {
    message('Не загрузилась библиотека MapLibre. Проверь интернет.');
    return;
  }

  var map = new maplibregl.Map({
    container: 'map',
    style: '/style.json',
    center: [80.4366, 47.96512],
    zoom: 13,
    minZoom: 0,
    maxZoom: 19
  });

  // Обновляем размеры canvas при изменении размера контейнера.
  if (window.ResizeObserver) {
    new ResizeObserver(function () { map.resize(); })
      .observe(document.getElementById('map'));
  }

  map.addControl(
    new maplibregl.NavigationControl(),
    'top-right'
  );

  map.on('load', function () {
    message('Карта загружена', true);
  });

  map.on('error', function (event) {
    console.error('Ошибка MapLibre:', event.error);
    message(
      'Ошибка загрузки карты или тайлов. Проверь /health и консоль браузера.',
      false
    );
  });

  var mode = '';
  var markers = {};
  var pickup = document.getElementById('pickup');
  var dropoff = document.getElementById('dropoff');

  function setMode(next) {
    mode = mode === next ? '' : next;
    pickup.classList.toggle('active', mode === 'pickup');
    dropoff.classList.toggle('active', mode === 'dropoff');

    if (mode) {
      message('Нажми на карту, чтобы выбрать точку', true);
    }
  }

  pickup.onclick = function () {
    setMode('pickup');
  };

  dropoff.onclick = function () {
    setMode('dropoff');
  };

  function pin(coords, which) {
    if (markers[which]) markers[which].remove();

    var element = document.createElement('div');

    element.style.cssText =
      'width:23px;height:23px;border:3px solid white;' +
      'border-radius:50%;background:' +
      (which === 'pickup' ? '#0e998c' : '#e97943') +
      ';box-shadow:0 2px 6px #0006';

    markers[which] = new maplibregl.Marker({
      element: element
    }).setLngLat(coords).addTo(map);

    message(
      which === 'pickup'
        ? 'Место посадки выбрано'
        : 'Место назначения выбрано',
      true
    );
  }

  map.on('click', function (event) {
    if (mode) {
      var selected = mode;

      pin(
        [event.lngLat.lng, event.lngLat.lat],
        selected
      );

      setMode(selected);
      return;
    }

    var layerNames = [
      'house-numbers',
      'poi-dots',
      'poi-names',
      'buildings',
      'road-names'
    ].filter(function (id) {
      return !!map.getLayer(id);
    });

    var f = map.queryRenderedFeatures(
      event.point,
      { layers: layerNames }
    )[0];

    if (!f) return;

    var p = f.properties || {};
    var parts = [];

    if (p.street) parts.push(p.street);
    if (p.housenumber) {
      parts.push('дом ' + p.housenumber);
    }

    var title =
      p.name_ru ||
      p.name ||
      p.name_kk ||
      parts.join(', ') ||
      'Объект на карте';

    var content = document.createElement('div');
    var strong = document.createElement('strong');

    strong.textContent = title;
    content.appendChild(strong);

    if (parts.length) {
      var details = document.createElement('div');
      details.textContent = parts.join(', ');
      content.appendChild(details);
    }

    new maplibregl.Popup({
      maxWidth: '280px'
    })
      .setLngLat(event.lngLat)
      .setDOMContent(content)
      .addTo(map);
  });

  document.getElementById('locate').onclick = function () {
    if (!navigator.geolocation) {
      message('Геолокация недоступна', true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function (position) {
        var coordinates = [
          position.coords.longitude,
          position.coords.latitude
        ];

        map.flyTo({
          center: coordinates,
          zoom: 16
        });

        message('Местоположение определено', true);
      },
      function () {
        message('Не получилось определить местоположение', true);
      },
      {
        enableHighAccuracy: true,
        timeout: 12000
      }
    );
  };

  var input = document.getElementById('query');
  var results = document.getElementById('results');
  var index = [];

  function normalize(value) {
    return String(value || '')
      .toLocaleLowerCase('ru')
      .replace(/ё/g, 'е')
      .replace(/[,.-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function search() {
    results.replaceChildren();

    var q = normalize(input.value);
    if (q.length < 2) return;

    var words = q.split(' ');

    var matches = index.filter(function (item) {
      var label = normalize(item.label);

      return words.every(function (word) {
        return label.includes(word);
      });
    }).slice(0, 12);

    if (!matches.length) {
      results.textContent = 'Совпадения не найдены в базе адресов';
      return;
    }

    matches.forEach(function (item) {
      var button = document.createElement('button');
      button.className = 'result';
      button.textContent = item.label;

      var subtitle = document.createElement('small');

      subtitle.textContent =
        item.kind === 'address'
          ? 'Адрес'
          : item.kind === 'street'
          ? 'Улица'
          : 'Место';

      button.appendChild(subtitle);

      button.onclick = function () {
        input.value = item.label;
        results.replaceChildren();

        map.flyTo({
          center: [item.lon, item.lat],
          zoom: item.kind === 'address' ? 17 : 15
        });

        new maplibregl.Popup()
          .setLngLat([item.lon, item.lat])
          .setText(item.label)
          .addTo(map);
      };

      results.appendChild(button);
    });
  }

  input.addEventListener('input', search);

  document.getElementById('clear').onclick = function () {
    input.value = '';
    results.replaceChildren();
    input.focus();
  };

  fetch('/search-index.json')
    .then(function (r) {
      if (!r.ok) throw Error('No search index');
      return r.json();
    })
    .then(function (data) {
      index = Array.isArray(data) ? data : [];

      document.getElementById('info').textContent =
        'В индексе: ' + index.length +
        ' адресов и улиц. Номера домов доступны с масштаба 16.';
    })
    .catch(function () {
      document.getElementById('info').textContent =
        'Поиск адресов появится после загрузки addresses.json в GitHub.';
    });
})();
</script>
</body>
</html>`;


// MBTiles server: the database stays local; browser requests use XYZ coordinates.
async function start() {
  if (!fs.existsSync(MAP_PATH)) throw Error('Положите ayagoz-v3.mbtiles рядом с server.js');
  const SQL = await initSqlJs({ locateFile: file => require.resolve('sql.js/dist/' + file) });
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(MAP_PATH)));
  const query = (sql, params = []) => {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      const result = [];
      while (stmt.step()) result.push(stmt.getAsObject());
      return result;
    } finally { stmt.free(); }
  };
  let metadata = {};
  try { for (const row of query('SELECT name,value FROM metadata')) metadata[row.name] = row.value; } catch (_) {}
  const perZoom = query('SELECT zoom_level AS zoom,COUNT(*) AS tiles FROM tiles GROUP BY zoom_level ORDER BY zoom_level');
  if (!perZoom.length) throw Error('В ayagoz-v3.mbtiles нет тайлов');
  if (metadata.format && !['pbf', 'mvt'].includes(metadata.format.toLowerCase())) {
    throw Error('Нужны векторные MBTiles (pbf/mvt), получен формат: ' + metadata.format);
  }
  const minzoom = Number(perZoom[0].zoom);
  const maxzoom = Number(perZoom[perZoom.length - 1].zoom);
  const scheme = (metadata.scheme || 'tms').toLowerCase();
  if (!['tms', 'xyz'].includes(scheme)) throw Error('Неизвестная схема тайлов: ' + scheme);
  let layerInfo = [];
  try { layerInfo = JSON.parse(metadata.json || '{}').vector_layers || []; } catch (_) {}
  const defaultLayers = ['addresses','buildings','landuse','places','pois','railways','roads','water','waterways'];
  const layerNames = new Set(layerInfo.length ? layerInfo.map(layer => layer.id) : defaultLayers);
  const stat = fs.statSync(MAP_PATH);
  const version = stat.size + '-' + Math.floor(stat.mtimeMs) + '-server2';
  let searchIndex = Buffer.from('[]');
  if (fs.existsSync(INDEX_PATH)) {
    const parsed = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    if (!Array.isArray(parsed)) throw Error('addresses.json должен содержать массив');
    searchIndex = Buffer.from(JSON.stringify(parsed));
  }
  const tileStatement = db.prepare('SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=? LIMIT 1');
  let served = 0;
  let missing = 0;
  const recentMissing = [];
  const overviewZoom = Math.max(...perZoom.filter(row => row.zoom <= 13).map(row => Number(row.zoom)), minzoom);
  // A genuine coarser source is positioned by MapLibre, avoiding misplaced parent tiles.
  function style() {
    const result = makeStyle('', minzoom, maxzoom, version, layerNames);
    result.sources.overview = { ...result.sources.ayagoz, maxzoom: overviewZoom };
    const geometry = result.layers.filter(layer => layer.type === 'fill' || layer.type === 'line')
      .map(layer => ({ ...layer, id: 'overview-' + layer.id, source: 'overview' }));
    const background = result.layers.filter(layer => layer.type === 'background');
    const detail = result.layers.filter(layer => layer.type !== 'background');
    result.layers = [...background, ...geometry, ...detail];
    return result;
  }
  const styleBytes = Buffer.from(JSON.stringify(style()));
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/') return respond(res, 200, 'text/html; charset=utf-8', HTML);
      if (url.pathname === '/style.json') return respond(res, 200, 'application/json; charset=utf-8', styleBytes);
      if (url.pathname === '/search-index.json') return respond(res, 200, 'application/json; charset=utf-8', searchIndex);
      if (url.pathname === '/health') return respond(res, 200, 'application/json; charset=utf-8', JSON.stringify({
        status:'ok', mapFile:path.basename(MAP_PATH), minzoom,maxzoom,scheme,overviewZoom,
        tiles:perZoom.reduce((sum,row) => sum + Number(row.tiles),0), perZoom,
        layers:[...layerNames], searchIndex:fs.existsSync(INDEX_PATH), served,missing,recentMissing
      }));
      const match = /^\/tiles\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(url.pathname);
      if (!match) return respond(res,404,'text/plain; charset=utf-8','Not found');
      const [z,x,y] = match.slice(1).map(Number);
      if (![z,x,y].every(Number.isSafeInteger) || z < minzoom || z > maxzoom || x >= 2 ** z || y >= 2 ** z) {
        return respond(res,404,'text/plain; charset=utf-8','Tile outside range');
      }
      const row = scheme === 'xyz' ? y : 2 ** z - 1 - y;
      tileStatement.reset();
      tileStatement.bind([z,x,row]);
      const bytes = tileStatement.step() ? tileStatement.getAsObject().tile_data : null;
      tileStatement.reset();
      if (!bytes || !bytes.length) {
        missing++;
        recentMissing.push([z,x,y]);
        if (recentMissing.length > 20) recentMissing.shift();
        return respond(res,204,'application/vnd.mapbox-vector-tile','');
      }
      served++;
      const headers = {
        'Content-Type':'application/vnd.mapbox-vector-tile',
        'Access-Control-Allow-Origin':'*',
        'Cache-Control':'public, max-age=86400',
        'Content-Length':bytes.length
      };
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) headers['Content-Encoding'] = 'gzip';
      res.writeHead(200,headers);
      res.end(Buffer.from(bytes));
    } catch (error) {
      console.error(error);
      if (!res.headersSent) respond(res,500,'text/plain; charset=utf-8','Server error');
      else res.destroy();
    }
  });
  server.on('error', error => { console.error(error); process.exitCode = 1; });
  server.listen(PORT,'0.0.0.0',() => console.log('Аягоз: ' + path.basename(MAP_PATH) + ', zoom ' + minzoom + '–' + maxzoom + ', ' + scheme + ', порт ' + PORT));
  function shutdown() { server.close(() => { tileStatement.free(); db.close(); process.exit(0); }); }
  process.once('SIGTERM',shutdown);
  process.once('SIGINT',shutdown);
}
start().catch(error => { console.error('Ошибка запуска:',error); process.exitCode = 1; });
