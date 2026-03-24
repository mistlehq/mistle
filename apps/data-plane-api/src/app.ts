import { OpenAPIHono } from "@hono/zod-openapi";

import { createInternalSandboxInstancesRoutes } from "./internal/index.js";
import type { AppRuntimeResources } from "./resources.js";
import type {
  AppContextBindings,
  DataPlaneApiConfig,
  DataPlaneApiGlobalConfig,
  DataPlaneApp,
} from "./types.js";

const DataPlaneOpenApiPath = "/openapi.json";

const DataPlaneInternalOpenApiInfo = {
  title: "Mistle Data Plane Internal API",
  version: "0.0.0",
};

export type CreateAppInput = {
  config: DataPlaneApiConfig;
  internalAuthServiceToken: string;
  resources: AppRuntimeResources;
  sandboxProvider: DataPlaneApiGlobalConfig["sandbox"]["provider"];
};

export function createApp(input: CreateAppInput): DataPlaneApp {
  const app = new OpenAPIHono<AppContextBindings>();

  configureApp({
    app,
    config: input.config,
    internalAuthServiceToken: input.internalAuthServiceToken,
    resources: input.resources,
    sandboxProvider: input.sandboxProvider,
  });

  return app;
}

export function configureApp(input: CreateAppInput & { app: DataPlaneApp }): void {
  const { app, config, internalAuthServiceToken, resources, sandboxProvider } = input;

  app.use("*", async (ctx, next) => {
    ctx.set("config", config);
    ctx.set("internalAuthServiceToken", internalAuthServiceToken);
    ctx.set("resources", resources);
    ctx.set("sandboxProvider", sandboxProvider);
    await next();
  });

  app.doc(DataPlaneOpenApiPath, {
    openapi: "3.1.0",
    info: DataPlaneInternalOpenApiInfo,
  });

  registerApiRouteModules(app);

  app.get("/__healthz", (ctx) => {
    return ctx.json({ ok: true });
  });
}

export function registerApiRouteModules(app: DataPlaneApp): void {
  registerInternalApiRouteModules(app);
}

export function registerInternalApiRouteModules(app: DataPlaneApp): void {
  const internalSandboxInstancesRoutes = createInternalSandboxInstancesRoutes();

  app.route(internalSandboxInstancesRoutes.basePath, internalSandboxInstancesRoutes.routes);
}
