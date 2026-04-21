import { serve, type ServerType } from "@hono/node-server";

import type { StartServerInput, StartedServer } from "./types.js";

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
  const server = serve({
    fetch: input.app.fetch,
    hostname: input.host,
    port: input.port,
  });

  return {
    server,
    close: async () => closeServer(server),
  };
}
