const net = require("node:net");

const port = Number.parseInt(process.argv[2] ?? "", 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("expected a TCP port argument");
}

net
  .createServer((socket) => {
    socket.on("error", () => {});
    socket.end(Buffer.from([0xff, 0x00, 0x01, 0x02]));
  })
  .listen(port, "127.0.0.1");

process.stdin.resume();
