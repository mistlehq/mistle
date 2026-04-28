import { OpenAPIHono } from "@hono/zod-openapi";
import { readRepositoryVersion } from "@mistle/config";

import { createInternalSandboxRoutes } from "./internal/index.js";
import type { AppRuntimeResources } from "./resources.js";
import type {
  AppContextBindings,
  DataPlaneApiConfig,
  DataPlaneApiSandboxStorageBackend,
  DataPlaneApp,
} from "./types.js";

const DataPlaneOpenApiPath = "/openapi.json";
const DataPlaneReleaseVersion = readRepositoryVersion(import.meta.url);

const DataPlaneInternalOpenApiInfo = {
  title: "Mistle Data Plane Internal API",
  version: DataPlaneReleaseVersion,
};

export type CreateAppInput = {
  config: DataPlaneApiConfig;
  internalAuthServiceToken: string;
  resources: AppRuntimeResources;
  sandboxProvider: DataPlaneApiConfig["sandbox"]["provider"];
  sandboxStorageBackend: DataPlaneApiSandboxStorageBackend;
};

export function createApp(input: CreateAppInput): DataPlaneApp {
  const app = new OpenAPIHono<AppContextBindings>();

  configureApp({
    app,
    config: input.config,
    internalAuthServiceToken: input.internalAuthServiceToken,
    resources: input.resources,
    sandboxProvider: input.sandboxProvider,
    sandboxStorageBackend: input.sandboxStorageBackend,
  });

  return app;
}

export function configureApp(input: CreateAppInput & { app: DataPlaneApp }): void {
  const {
    app,
    config,
    internalAuthServiceToken,
    resources,
    sandboxProvider,
    sandboxStorageBackend,
  } = input;

  app.use("*", async (ctx, next) => {
    ctx.set("config", config);
    ctx.set("internalAuthServiceToken", internalAuthServiceToken);
    ctx.set("resources", resources);
    ctx.set("controlPlaneInternalClient", resources.controlPlaneInternalClient);
    ctx.set("sandboxProvider", sandboxProvider);
    ctx.set("sandboxStorageBackend", sandboxStorageBackend);
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
  const internalSandboxRoutes = createInternalSandboxRoutes();

  app.route(internalSandboxRoutes.basePath, internalSandboxRoutes.routes);
}
