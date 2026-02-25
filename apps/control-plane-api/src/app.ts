import { OpenAPIHono } from "@hono/zod-openapi";

import type { AppContextBindings, ControlPlaneApiConfig, ControlPlaneApp } from "./types.js";

import {
  createAppResources,
  getAppDatabase,
  setAppResources,
  stopAppResources,
} from "./runtime/resources.js";
import { registerAppRoutes } from "./runtime/routes.js";
import { createAppServices } from "./service.js";

export async function createApp(config: ControlPlaneApiConfig): Promise<ControlPlaneApp> {
  const app = new OpenAPIHono<AppContextBindings>();
  const resources = await createAppResources(config);
  const services = createAppServices({
    config,
    resources,
  });

  registerAppRoutes({
    app,
    config,
    db: resources.db,
    services,
  });
  setAppResources(app, resources);

  return app;
}

export async function stopApp(app: ControlPlaneApp): Promise<void> {
  await stopAppResources(app);
}

export { getAppDatabase };
