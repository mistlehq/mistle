import { Hono } from "hono";

import type { AppContextBindings, ControlPlaneWorkerApp } from "./types.js";

export function createApp(): ControlPlaneWorkerApp {
  const app = new Hono<AppContextBindings>();

  app.get("/__healthz", (c) => {
    return c.json({ ok: true });
  });

  return app;
}
