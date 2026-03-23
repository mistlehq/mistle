import { OpenAPIHono } from "@hono/zod-openapi";

import { createAppResources, setAppResources, stopAppResources } from "./runtime/resources.js";
import { registerAppRoutes } from "./runtime/routes.js";
import type { AppContextBindings, DataPlaneApiRuntimeConfig, DataPlaneApp } from "./types.js";

export async function createApp(runtimeConfig: DataPlaneApiRuntimeConfig): Promise<DataPlaneApp> {
  const app = new OpenAPIHono<AppContextBindings>();
  const resources = await createAppResources(runtimeConfig);

  registerAppRoutes({
    app,
    config: runtimeConfig.app,
    internalAuthServiceToken: runtimeConfig.internalAuthServiceToken,
    resources,
    sandboxProvider: runtimeConfig.sandboxProvider,
  });

  setAppResources(app, resources);

  return app;
}

export async function stopApp(app: DataPlaneApp): Promise<void> {
  await stopAppResources(app);
}
