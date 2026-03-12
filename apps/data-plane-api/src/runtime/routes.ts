import { createInternalSandboxInstancesApp } from "../internal-sandbox-instances/index.js";
import { DATA_PLANE_INTERNAL_OPENAPI_INFO, DATA_PLANE_OPENAPI_PATH } from "../openapi/constants.js";
import type { DataPlaneApiConfig, DataPlaneApiGlobalConfig, DataPlaneApp } from "../types.js";
import type { AppRuntimeResources } from "./resources.js";

type RegisterAppRoutesInput = {
  app: DataPlaneApp;
  config: DataPlaneApiConfig;
  internalAuthServiceToken: string;
  resources: AppRuntimeResources;
  sandboxProvider: DataPlaneApiGlobalConfig["sandbox"]["provider"];
};

export function registerAppRoutes(input: RegisterAppRoutesInput): void {
  const { app, config, internalAuthServiceToken, resources, sandboxProvider } = input;

  app.use("*", async (ctx, next) => {
    ctx.set("config", config);
    ctx.set("internalAuthServiceToken", internalAuthServiceToken);
    ctx.set("resources", resources);
    ctx.set("sandboxProvider", sandboxProvider);
    await next();
  });

  app.doc(DATA_PLANE_OPENAPI_PATH, {
    openapi: "3.1.0",
    info: DATA_PLANE_INTERNAL_OPENAPI_INFO,
  });

  registerInternalApiRouteModules(app);

  app.get("/__healthz", (ctx) => {
    return ctx.json({ ok: true });
  });
}

export function registerInternalApiRouteModules(app: DataPlaneApp): void {
  const internalSandboxInstancesApp = createInternalSandboxInstancesApp();

  app.route(internalSandboxInstancesApp.basePath, internalSandboxInstancesApp.routes);
}
