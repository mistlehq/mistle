import { Hono } from "hono";

import type { AppContextBindings, DataPlaneGatewayApp } from "./types.js";

export function createApp(): DataPlaneGatewayApp {
  const app = new Hono<AppContextBindings>();

  app.get("/__healthz", (c) => {
    return c.json({ ok: true });
  });

  return app;
}
