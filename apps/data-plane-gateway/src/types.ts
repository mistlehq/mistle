import type { ServerType } from "@hono/node-server";
import { AppIds, type loadConfig } from "@mistle/config";
import type { DataPlaneDatabase } from "@mistle/db/data-plane";
import type { Context, Hono } from "hono";

type LoadDataPlaneGatewayConfigResult = ReturnType<
  typeof loadConfig<typeof AppIds.DATA_PLANE_GATEWAY>
>;

export type DataPlaneGatewayConfig = LoadDataPlaneGatewayConfigResult["app"];
export type DataPlaneGatewayGlobalConfig = NonNullable<LoadDataPlaneGatewayConfigResult["global"]>;
export type DataPlaneGatewayRuntimeConfig = {
  app: DataPlaneGatewayConfig;
  sandbox: DataPlaneGatewayGlobalConfig["sandbox"];
};

export type AppContextBindings = {
  Variables: AppContextVariables;
};

export type AppContextVariables = {
  config: DataPlaneGatewayConfig;
  db: DataPlaneDatabase;
};

export type AppContext = Context<AppContextBindings>;
export type DataPlaneGatewayApp = Hono<AppContextBindings>;

export type StartServerInput = {
  app: DataPlaneGatewayApp;
  host: string;
  port: number;
};

export type StartedServer = {
  server: ServerType;
  close: () => Promise<void>;
};

export type DataPlaneGatewayRuntime = {
  app: DataPlaneGatewayApp;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};
