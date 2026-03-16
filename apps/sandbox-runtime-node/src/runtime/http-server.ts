import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

import type { ProxyServer } from "./proxy/proxy-server.js";
import { createRouter, type RouterState } from "./router.js";

export function createRuntimeHttpServer(input: {
  state: RouterState;
  proxyServer?: ProxyServer;
}): Server {
  const router = createRouter({
    state: input.state,
  });

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.url === "/__healthz") {
      router(request, response);
      return;
    }

    if (request.url !== undefined && request.url.startsWith("/")) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }

    if (input.proxyServer === undefined) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }

    void input.proxyServer.handleHttpRequest(request, response);
  });

  server.on("connect", (request, socket: Socket, head) => {
    if (input.proxyServer === undefined) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    input.proxyServer.handleConnect(request, socket, head);
  });

  return server;
}
