import type { ServerType } from "@hono/node-server";
import type { Context, Hono } from "hono";

import { AppIds, type loadConfig } from "@mistle/config";

type LoadControlPlaneWorkerConfigResult = ReturnType<
  typeof loadConfig<typeof AppIds.CONTROL_PLANE_WORKER>
>;

export type ControlPlaneWorkerConfig = LoadControlPlaneWorkerConfigResult["app"];
export type ControlPlaneWorkerGlobalConfig = NonNullable<
  LoadControlPlaneWorkerConfigResult["global"]
>;
export type ControlPlaneWorkerRuntimeConfig = {
  app: ControlPlaneWorkerConfig;
  internalAuthServiceToken: ControlPlaneWorkerGlobalConfig["internalAuth"]["serviceToken"];
};

export type AppContextBindings = {
  Variables: AppContextVariables;
};

export type AppContextVariables = {
  config: ControlPlaneWorkerConfig;
  internalAuthServiceToken: string;
};

export type AppContext = Context<AppContextBindings>;
export type ControlPlaneWorkerApp = Hono<AppContextBindings>;

export type StartServerInput = {
  app: ControlPlaneWorkerApp;
  host: string;
  port: number;
};

export type StartedServer = {
  server: ServerType;
  close: () => Promise<void>;
};

export type ControlPlaneWorkerRuntime = {
  app: ControlPlaneWorkerApp;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};
