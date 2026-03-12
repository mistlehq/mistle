import type { ServerType } from "@hono/node-server";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { AppIds, type loadConfig } from "@mistle/config";
import type { Context, Hono } from "hono";

import type { AppRuntimeResources } from "./runtime/resources.js";

type LoadDataPlaneApiConfigResult = ReturnType<typeof loadConfig<typeof AppIds.DATA_PLANE_API>>;

export type DataPlaneApiConfig = LoadDataPlaneApiConfigResult["app"];
export type DataPlaneApiGlobalConfig = NonNullable<LoadDataPlaneApiConfigResult["global"]>;
export type DataPlaneApiRuntimeConfig = {
  app: DataPlaneApiConfig;
  internalAuthServiceToken: DataPlaneApiGlobalConfig["internalAuth"]["serviceToken"];
  sandboxProvider: DataPlaneApiGlobalConfig["sandbox"]["provider"];
};

export type AppContextBindings = {
  Variables: AppContextVariables;
};

export type AppRoutes<BasePath> = {
  basePath: BasePath;
  routes: Hono<AppContextBindings>;
};

export type AppContextVariables = {
  config: DataPlaneApiConfig;
  internalAuthServiceToken: string;
  resources: AppRuntimeResources;
  sandboxProvider: DataPlaneApiGlobalConfig["sandbox"]["provider"];
};

export type AppContext = Context<AppContextBindings>;
export type DataPlaneApp = OpenAPIHono<AppContextBindings>;

export type StartServerInput = {
  app: DataPlaneApp;
  host: string;
  port: number;
};

export type StartedServer = {
  server: ServerType;
  close: () => Promise<void>;
};

export type DataPlaneApiRuntime = {
  app: DataPlaneApp;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};
