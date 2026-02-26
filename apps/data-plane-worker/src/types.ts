import type { ServerType } from "@hono/node-server";
import type { Context, Hono } from "hono";

import { AppIds, type loadConfig } from "@mistle/config";

type LoadDataPlaneWorkerConfigResult = ReturnType<
  typeof loadConfig<typeof AppIds.DATA_PLANE_WORKER>
>;

export type DataPlaneWorkerConfig = LoadDataPlaneWorkerConfigResult["app"];

export type AppContextBindings = {
  Variables: AppContextVariables;
};

export type AppContextVariables = {
  config: DataPlaneWorkerConfig;
};

export type AppContext = Context<AppContextBindings>;
export type DataPlaneWorkerApp = Hono<AppContextBindings>;

export type StartServerInput = {
  app: DataPlaneWorkerApp;
  host: string;
  port: number;
};

export type StartedServer = {
  server: ServerType;
  close: () => Promise<void>;
};

export type DataPlaneWorkerRuntime = {
  app: DataPlaneWorkerApp;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};
