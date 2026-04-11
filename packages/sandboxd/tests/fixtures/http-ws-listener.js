const crypto = require("node:crypto");
const http = require("node:http");

const port = Number(process.argv[2]);
const marker = process.argv[3] ?? "http-ws-listener";

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  response.end(marker);
});

server.on("upgrade", (request, socket) => {
  const websocketKey = request.headers["sec-websocket-key"];
  if (typeof websocketKey !== "string") {
    socket.destroy();
    return;
  }

  const acceptValue = crypto
    .createHash("sha1")
    .update(`${websocketKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptValue}`,
      "",
      "",
    ].join("\r\n"),
  );
  socket.end();
});

server.listen(port, "127.0.0.1");
