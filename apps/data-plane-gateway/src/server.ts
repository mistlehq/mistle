import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import { createAdaptorServer, type ServerType } from "@hono/node-server";

import type { StartServerInput, StartedServer } from "./types.js";

type RequestListener = (request: IncomingMessage, response: ServerResponse) => void;
type UpgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

function closeServer(server: ServerType): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function collectRequestListeners(server: ServerType): RequestListener[] {
  return server.listeners("request").map((listener) => {
    if (typeof listener !== "function") {
      throw new Error("Expected request listener to be a function.");
    }

    return (request, response) => {
      listener(request, response);
    };
  });
}

function installPortAccessRequestEntrypoint(input: {
  portAccessNodeEntrypoint: NonNullable<StartServerInput["portAccessNodeEntrypoint"]>;
  server: ServerType;
}): void {
  const existingRequestListeners = collectRequestListeners(input.server);
  input.server.removeAllListeners("request");
  input.server.on("request", (request, response) => {
    input.portAccessNodeEntrypoint.handleRequest(request, response).then(
      (handled) => {
        if (handled) {
          return;
        }

        for (const listener of existingRequestListeners) {
          listener(request, response);
        }
      },
      (error: unknown) => {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        response.destroy(normalizedError);
      },
    );
  });
}

function collectUpgradeListeners(server: ServerType): UpgradeListener[] {
  return server.listeners("upgrade").map((listener) => {
    if (typeof listener !== "function") {
      throw new Error("Expected upgrade listener to be a function.");
    }

    return (request, socket, head) => {
      listener(request, socket, head);
    };
  });
}

export function installPortAccessUpgradeEntrypoint(input: {
  portAccessNodeEntrypoint: NonNullable<StartServerInput["portAccessNodeEntrypoint"]>;
  server: ServerType;
}): void {
  const server = input.server;
  const existingUpgradeListeners = collectUpgradeListeners(server);
  server.removeAllListeners("upgrade");
  server.on("upgrade", (request, socket, head) => {
    input.portAccessNodeEntrypoint.handleUpgrade(request, socket, Buffer.from(head)).then(
      (handled) => {
        if (handled) {
          return;
        }

        for (const listener of existingUpgradeListeners) {
          listener(request, socket, head);
        }
      },
      (error: unknown) => {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        socket.destroy(normalizedError);
      },
    );
  });
}

export function startServer(input: StartServerInput): StartedServer {
  const server = createAdaptorServer({
    fetch: input.app.fetch,
    hostname: input.host,
  });
  if (input.portAccessNodeEntrypoint !== undefined) {
    installPortAccessRequestEntrypoint({
      portAccessNodeEntrypoint: input.portAccessNodeEntrypoint,
      server,
    });
  }
  server.listen(input.port, input.host);

  return {
    server,
    close: async () => closeServer(server),
  };
}
