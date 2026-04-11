import net from "node:net";

const port = Number(process.argv[2]);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Expected a positive integer port, got ${String(process.argv[2])}`);
}

const server = net.createServer((socket) => {
  socket.write("NOT_HTTP\n");
  socket.end();
});

server.listen(port, "127.0.0.1");

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
