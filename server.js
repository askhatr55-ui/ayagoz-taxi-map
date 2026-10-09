const http = require("http");

const PORT = process.env.PORT || 10000;

const html = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">

  <meta name="viewport"
        content="width=device-width, initial-scale=1.0">

  <title>Ayagoz Taxi Map</title>

  <link
    href="https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.css"
    rel="stylesheet"
  />

  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
    }

    #map {
      width: 100%;
      height: 100vh;
    }

    .title {
      position: absolute;
      top: 15px;
      left: 15px;
      z-index: 10;
      background: white;
      padding: 12px;
      border-radius: 10px;
      box-shadow: 0 2px 10px #0002;
    }
  </style>
</head>

<body>

  <div class="title">
    🚕 Ayagoz Taxi
  </div>

  <div id="map"></div>

  <script src="https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.js"></script>

  <script>
    const map = new maplibregl.Map({
      container: "map",

      style: "https://demotiles.maplibre.org/style.json",

      center: [80.43, 47.97],

      zoom: 12
    });

    map.addControl(
      new maplibregl.NavigationControl()
    );

    new maplibregl.Marker({
      color: "#FF0000"
    })
      .setLngLat([80.43, 47.97])
      .addTo(map);
  </script>

</body>
</html>
`;

const server = http.createServer((req, res) => {

  if (req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json"
    });

    res.end(JSON.stringify({
      status: "ok",
      service: "Ayagoz Taxi Map"
    }));

    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8"
  });

  res.end(html);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Ayagoz Taxi Map started");
});
