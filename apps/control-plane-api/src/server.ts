import { createServer } from "node:http";

import { getRequestListener, serve, type ServerType } from "@hono/node-server";

import type { NodeRequestHandler, StartServerInput, StartedServer } from "./types.js";

function closeServer(server: ServerType): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        if (error.message === "Server is not running.") {
          resolve();
          return;
        }
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export function startServer(input: StartServerInput): StartedServer {
  const server =
    input.nodeRequestHandlers === undefined || input.nodeRequestHandlers.length === 0
      ? serve({
          fetch: input.app.fetch,
          hostname: input.host,
          port: input.port,
        })
      : startServerWithNodeRequestHandlers(input);

  return {
    server,
    close: async () => closeServer(server),
  };
}

function startServerWithNodeRequestHandlers(input: StartServerInput): ServerType {
  const honoRequestListener = getRequestListener(input.app.fetch, { hostname: input.host });
  const nodeRequestHandlers = input.nodeRequestHandlers;

  if (nodeRequestHandlers === undefined || nodeRequestHandlers.length === 0) {
    throw new Error("Cannot start Node handler dispatch server without Node request handlers.");
  }

  const server = createServer((request, response) => {
    void dispatchNodeRequest({
      honoRequestListener,
      nodeRequestHandlers,
      request,
      response,
    }).catch((error: unknown) => {
      handleNodeRequestDispatchError({ error, response });
    });
  });

  server.listen(input.port, input.host);

  return server;
}

async function dispatchNodeRequest(input: {
  honoRequestListener: (
    request: Parameters<NodeRequestHandler["handle"]>[0],
    response: Parameters<NodeRequestHandler["handle"]>[1],
  ) => Promise<void> | void;
  nodeRequestHandlers: readonly NodeRequestHandler[];
  request: Parameters<NodeRequestHandler["matches"]>[0];
  response: Parameters<NodeRequestHandler["handle"]>[1];
}): Promise<void> {
  const matchingHandler = findMatchingNodeRequestHandler(input.nodeRequestHandlers, input.request);
  if (matchingHandler !== undefined) {
    await matchingHandler.handle(input.request, input.response);
    return;
  }

  await input.honoRequestListener(input.request, input.response);
}

function handleNodeRequestDispatchError(input: {
  error: unknown;
  response: Parameters<NodeRequestHandler["handle"]>[1];
}): void {
  if (input.response.writableEnded) {
    return;
  }

  if (input.response.headersSent) {
    input.response.destroy(input.error instanceof Error ? input.error : undefined);
    return;
  }

  input.response.statusCode = 500;
  input.response.setHeader("content-type", "text/plain; charset=utf-8");
  input.response.end("Internal Server Error");
}

function findMatchingNodeRequestHandler(
  handlers: readonly NodeRequestHandler[],
  request: Parameters<NodeRequestHandler["matches"]>[0],
): NodeRequestHandler | undefined {
  return handlers.find((handler) => handler.matches(request));
}
