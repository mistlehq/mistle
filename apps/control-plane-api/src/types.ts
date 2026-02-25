import type { loadConfig } from "@mistle/config";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { Context, Hono } from "hono";

import type { ControlPlaneAuth } from "./auth/index.js";

export type ControlPlaneApiConfig = ReturnType<typeof loadConfig>["app"];

export type AppContextBindings = {
  Variables: AppContextVariables;
};

export type AppRoutes<BasePath> = {
  basePath: BasePath;
  routes: Hono<AppContextBindings>;
};

export type AppServices = {
  auth: ControlPlaneAuth;
};

export type AppContextVariables = {
  config: ControlPlaneApiConfig;
  db: ControlPlaneDatabase;
  services: AppServices;
};

export type AppContext = Context<AppContextBindings>;
export type ControlPlaneApp = Hono<AppContextBindings>;
