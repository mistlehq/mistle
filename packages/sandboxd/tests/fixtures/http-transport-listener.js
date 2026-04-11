import http from "node:http";

const port = Number(process.argv[2]);
const marker = process.argv[3] ?? "http-transport-listener";

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Expected a positive integer port, got ${String(process.argv[2])}`);
}

const server = http.createServer((request, response) => {
  if (request.url === "/close-early") {
    response.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "x-fixture": marker,
    });
    response.flushHeaders();
    response.write("partial:");
    setImmediate(() => {
      response.socket?.destroy();
    });
    return;
  }

  const bodyChunks = [];
  request.on("data", (chunk) => {
    bodyChunks.push(Buffer.from(chunk));
  });
  request.on("end", () => {
    const responseBody = JSON.stringify({
      method: request.method,
      url: request.url,
      headers: {
        host: request.headers.host,
        "x-forwarded-host": request.headers["x-forwarded-host"],
        "x-forwarded-proto": request.headers["x-forwarded-proto"],
        "x-forwarded-port": request.headers["x-forwarded-port"],
        "x-request-marker": request.headers["x-request-marker"],
      },
      body: Buffer.concat(bodyChunks).toString("utf8"),
    });

    response.writeHead(201, {
      "content-type": "application/json; charset=utf-8",
      "x-fixture": marker,
      connection: "keep-alive",
    });
    response.end(responseBody);
  });
});

server.listen(port, "127.0.0.1");

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
