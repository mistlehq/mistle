import { Hono } from "hono";

import { createAppResources, setAppResources, stopAppResources } from "./runtime/resources.js";
import type { AppContextBindings, DataPlaneGatewayApp, DataPlaneGatewayConfig } from "./types.js";

export function createApp(config: DataPlaneGatewayConfig): DataPlaneGatewayApp {
  const app = new Hono<AppContextBindings>();
  const resources = createAppResources(config);

  app.use("*", async (ctx, next) => {
    ctx.set("config", config);
    ctx.set("db", resources.db);
    await next();
  });

  app.get("/__healthz", (c) => {
    return c.json({ ok: true });
  });

  setAppResources(app, resources);

  return app;
}

export async function stopApp(app: DataPlaneGatewayApp): Promise<void> {
  await stopAppResources(app);
}
