import { OpenAPIHono } from "@hono/zod-openapi";

import {
  createAppResources,
  getAppDatabase,
  setAppResources,
  stopAppResources,
} from "./runtime/resources.js";
import { registerAppRoutes } from "./runtime/routes.js";
import { createAppServices } from "./service.js";
import type { AppContextBindings, ControlPlaneApiRuntimeConfig, ControlPlaneApp } from "./types.js";

export async function createApp(
  runtimeConfig: ControlPlaneApiRuntimeConfig,
): Promise<ControlPlaneApp> {
  const app = new OpenAPIHono<AppContextBindings>();
  const resources = await createAppResources(runtimeConfig.app);
  const services = createAppServices({
    runtimeConfig,
    resources,
  });

  registerAppRoutes({
    app,
    config: runtimeConfig.app,
    sandboxConfig: runtimeConfig.sandbox,
    internalAuthServiceToken: runtimeConfig.internalAuthServiceToken,
    db: resources.db,
    integrationRegistry: resources.integrationRegistry,
    openWorkflow: resources.openWorkflow,
    services,
  });
  setAppResources(app, resources);

  return app;
}

export async function stopApp(app: ControlPlaneApp): Promise<void> {
  await stopAppResources(app);
}

export { getAppDatabase };
