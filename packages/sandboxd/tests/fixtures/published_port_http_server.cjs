const net = require("node:net");

const port = Number.parseInt(process.argv[2] ?? "", 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("expected a TCP port argument");
}

net
  .createServer((socket) => {
    let request = "";
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      request += chunk.toString("utf8");
      if (!request.includes("\r\n\r\n")) {
        return;
      }

      const response = request.includes("Upgrade: websocket")
        ? "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"
        : "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
      socket.end(response);
    });
  })
  .listen(port, "127.0.0.1");

process.stdin.resume();
