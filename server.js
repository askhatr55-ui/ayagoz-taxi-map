const http = require("http");
const fs = require("fs");
const initSqlJs = require("sql.js");

const PORT = process.env.PORT || 3000;

async function start() {
  const SQL = await initSqlJs({
    locateFile: file => require.resolve("sql.js/dist/" + file)
  });

  const db = new SQL.Database(
    new Uint8Array(fs.readFileSync("./ayagoz-v3.mbtiles"))
  );

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ayagoz Taxi Map</title>
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; }
    #map { width: 100vw; height: 100vh; }
    .header {
      position: absolute; top: 12px; left: 12px;
      z-index: 2; background: white; padding: 12px;
      border-radius: 10px; box-shadow: 0 2px 10px #0002;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <div class="header">🚕 Ayagoz Taxi Map</div>

  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <script>
    const style = {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        ayagoz: {
          type: "vector",
          tiles: [location.origin + "/tiles/{z}/{x}/{y}.pbf"],
          minzoom: 10,
          maxzoom: 14,
          attribution: "© OpenStreetMap contributors"
        }
      },
      layers: [
        {
          id: "background",
          type: "background",
          paint: { "background-color": "#eef2e8" }
        },
        {
          id: "water",
          type: "fill",
          source: "ayagoz",
          "source-layer": "water",
          paint: { "fill-color": "#a8d7ed" }
        },
        {
          id: "buildings",
          type: "fill",
          source: "ayagoz",
          "source-layer": "buildings",
          paint: {
            "fill-color": "#d5d1c8",
            "fill-outline-color": "#bbb7ae"
          }
        },
        {
          id: "roads",
          type: "line",
          source: "ayagoz",
          "source-layer": "roads",
          paint: {
            "line-color": "#ffffff",
            "line-width": ["interpolate", ["linear"], ["zoom"],
              10, 1, 14, 4, 17, 12]
          }
        },
        {
          id: "road-names",
          type: "symbol",
          source: "ayagoz",
          "source-layer": "roads",
          minzoom: 13,
          layout: {
            "symbol-placement": "line",
            "text-field": ["coalesce", ["get", "name"], ""],
            "text-font": ["Noto Sans Regular"],
            "text-size": 12
          },
          paint: {
            "text-color": "#484848",
            "text-halo-color": "#ffffff",
            "text-halo-width": 2
          }
        },
        {
          id: "place-names",
          type: "symbol",
          source: "ayagoz",
          "source-layer": "places",
          layout: {
            "text-field": ["coalesce", ["get", "name"], ""],
            "text-font": ["Noto Sans Regular"],
            "text-size": 15
          },
          paint: {
            "text-color": "#333333",
            "text-halo-color": "#ffffff",
            "text-halo-width": 2
          }
        }
      ]
    };

    const map = new maplibregl.Map({
      container: "map",
      style: style,
      center: [80.4366, 47.96512],
      zoom: 13,
      maxZoom: 19
    });

    map.addControl(new maplibregl.NavigationControl());
  </script>
</body>
</html>`;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");

    res.setHeader("Access-Control-Allow-Origin", "*");

    if (url.pathname === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "ok", map: "Ayagoz" }));
      return;
    }

   const match = url.pathname.match(
  /^\/tiles\/(\d+)\/(\d+)\/(\d+)\.pbf$/
    );

    if (match) {
      const [z, x, y] = match.slice(1).map(Number);

      if (
        z < 10 || z > 14 ||
        x < 0 || y < 0 ||
        x >= 2 ** z || y >= 2 ** z
      ) {
        res.writeHead(404);
        res.end("Tile not found");
        return;
      }

      const tmsY = 2 ** z - 1 - y;

      const stmt = db.prepare(
        "SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?"
      );

      stmt.bind([z, x, tmsY]);
      const tile = stmt.step()
        ? stmt.getAsObject().tile_data
        : null;
      stmt.free();

      if (!tile) {
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(200, {
        "Content-Type": "application/vnd.mapbox-vector-tile",
        "Content-Encoding": "gzip",
        "Cache-Control": "public, max-age=86400"
      });

      res.end(Buffer.from(tile));
      return;
    }

    if (url.pathname === "/") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8"
      });
      res.end(html);
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log("Ayagoz Taxi Map running on port " + PORT);
  });
}

start().catch(err => {
  console.error(err);
  process.exit(1);
});
