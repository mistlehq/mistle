import { createAdaptorServer, type ServerType } from "@hono/node-server";

import type { StartServerInput, StartedServer } from "./types.js";

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

export function startServer(input: StartServerInput): StartedServer {
  const server = createAdaptorServer({
    fetch: input.app.fetch,
  });
  if (input.onUpgrade !== undefined) {
    server.on("upgrade", input.onUpgrade);
  }
  server.listen(input.port, input.host);

  return {
    server,
    close: async () => closeServer(server),
  };
}
