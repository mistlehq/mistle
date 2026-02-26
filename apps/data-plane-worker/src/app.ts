import { Hono } from "hono";

import type { AppContextBindings, DataPlaneWorkerApp } from "./types.js";

export function createApp(): DataPlaneWorkerApp {
  const app = new Hono<AppContextBindings>();

  app.get("/__healthz", (c) => {
    return c.json({ ok: true });
  });

  return app;
}
