import http from "node:http";

const port = Number(process.argv[2]);
const marker = process.argv[3] ?? "http-listener";

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Expected a positive integer port, got ${String(process.argv[2])}`);
}

const server = http.createServer((_request, response) => {
  response.writeHead(200, {
    "content-type": "text/plain; charset=utf-8",
  });
  response.end(`ok:${marker}`);
});

server.listen(port, "127.0.0.1");

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
