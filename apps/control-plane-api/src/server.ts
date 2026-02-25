import { serve } from "@hono/node-server";

import type { ControlPlaneApp } from "./types.js";

export type StartServerInput = {
  app: ControlPlaneApp;
  host: string;
  port: number;
};

export function startServer(input: StartServerInput): void {
  serve({
    fetch: input.app.fetch,
    hostname: input.host,
    port: input.port,
  });
}
