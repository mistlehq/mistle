import type { ServerType } from "@hono/node-server";
import { AppIds, type loadConfig } from "@mistle/config";
import type { Context, Hono } from "hono";

type LoadControlPlaneWorkerConfigResult = ReturnType<
  typeof loadConfig<typeof AppIds.CONTROL_PLANE_WORKER>
>;

export type ControlPlaneWorkerConfig = LoadControlPlaneWorkerConfigResult["app"];
export type ControlPlaneWorkerGlobalConfig = NonNullable<
  LoadControlPlaneWorkerConfigResult["global"]
>;
export type ControlPlaneWorkerSandboxRuntimeConfig = {
  defaultBaseImage: ControlPlaneWorkerGlobalConfig["sandbox"]["defaultBaseImage"];
  gatewayWsUrl: ControlPlaneWorkerGlobalConfig["sandbox"]["gatewayWsUrl"];
};
export type ControlPlaneWorkerRuntimeConfig = {
  app: ControlPlaneWorkerConfig;
  internalAuthServiceToken: ControlPlaneWorkerGlobalConfig["internalAuth"]["serviceToken"];
  sandbox: ControlPlaneWorkerSandboxRuntimeConfig;
};

export type AppContextBindings = {
  Variables: AppContextVariables;
};

export type AppContextVariables = {
  config: ControlPlaneWorkerConfig;
  sandboxConfig: ControlPlaneWorkerSandboxRuntimeConfig;
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
