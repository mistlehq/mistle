import { serve } from "@hono/node-server";

import { createApp } from "./app.js";

export function startServer(port = 3002): void {
  const app = createApp();

  serve({
    fetch: app.fetch,
    port,
  });
}
