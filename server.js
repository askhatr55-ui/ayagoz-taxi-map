const http = require("http");

const PORT = process.env.PORT || 10000;

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

  res.end(`
    <html>
      <head>
        <meta name="viewport"
              content="width=device-width, initial-scale=1">
        <title>Ayagoz Taxi Map</title>
      </head>
      <body>
        <h1>🚕 Ayagoz Taxi Map</h1>
        <p>Сервер успешно работает!</p>
        <p>Следующий этап: подключение карты Аягоза.</p>
      </body>
    </html>
  `);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Ayagoz Taxi Map server started");
});
