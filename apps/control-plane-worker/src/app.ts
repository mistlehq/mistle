import { Hono } from "hono";

import type {
  AppContextBindings,
  ControlPlaneWorkerApp,
  ControlPlaneWorkerRuntimeConfig,
} from "./types.js";

export function createApp(runtimeConfig: ControlPlaneWorkerRuntimeConfig): ControlPlaneWorkerApp {
  const app = new Hono<AppContextBindings>();
  app.use("*", async (ctx, next) => {
    ctx.set("config", runtimeConfig.app);
    ctx.set("sandboxConfig", runtimeConfig.sandbox);
    ctx.set("internalAuthServiceToken", runtimeConfig.internalAuthServiceToken);
    await next();
  });

  app.get("/__healthz", (c) => {
    return c.json({ ok: true });
  });

  return app;
}
