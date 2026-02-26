import { Hono } from "hono";

import type { AppContextBindings, DataPlaneApiConfig, DataPlaneApp } from "./types.js";

import { createAppResources, setAppResources, stopAppResources } from "./runtime/resources.js";

export async function createApp(config: DataPlaneApiConfig): Promise<DataPlaneApp> {
  const app = new Hono<AppContextBindings>();
  const resources = await createAppResources(config);

  app.get("/__healthz", (c) => {
    return c.json({ ok: true });
  });

  setAppResources(app, resources);

  return app;
}

export async function stopApp(app: DataPlaneApp): Promise<void> {
  await stopAppResources(app);
}
