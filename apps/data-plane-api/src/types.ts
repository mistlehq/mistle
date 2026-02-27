import type { ServerType } from "@hono/node-server";
import type { Context, Hono } from "hono";

import { AppIds, type loadConfig } from "@mistle/config";

type LoadDataPlaneApiConfigResult = ReturnType<typeof loadConfig<typeof AppIds.DATA_PLANE_API>>;

export type DataPlaneApiConfig = LoadDataPlaneApiConfigResult["app"];

export type AppContextBindings = {
  Variables: AppContextVariables;
};

export type AppContextVariables = {
  config: DataPlaneApiConfig;
};

export type AppContext = Context<AppContextBindings>;
export type DataPlaneApp = Hono<AppContextBindings>;

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
