import { createServer, type Server } from "node:http";

export async function startStressRuntime(input: { host: string; port: number }): Promise<{
  hostBaseUrl: string;
  stop: () => Promise<void>;
}> {
  let requestCount = 0;
  const server = createServer((request, response) => {
    if (request.url === "/__healthz") {
      response.writeHead(200, {
        "content-type": "text/plain",
      });
      response.end("ok");
      return;
    }

    requestCount += 1;
    response.writeHead(200, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify({
        remotePort: request.socket.remotePort,
        requestCount,
        service: "stress-pooled-http-service",
      }),
    );
  });

  await new Promise<void>((resolve) => {
    server.listen(input.port, input.host, resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("Expected stress runtime to listen on a TCP port.");
  }

  return {
    hostBaseUrl: `http://127.0.0.1:${String(address.port)}`,
    stop: async () => {
      await closeServer(server);
    },
  };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}
