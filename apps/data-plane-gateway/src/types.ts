import type { ServerType } from "@hono/node-server";
import type { Context, Hono } from "hono";

import { AppIds, type loadConfig } from "@mistle/config";

type LoadDataPlaneGatewayConfigResult = ReturnType<
  typeof loadConfig<typeof AppIds.DATA_PLANE_GATEWAY>
>;

export type DataPlaneGatewayConfig = LoadDataPlaneGatewayConfigResult["app"];

export type AppContextBindings = {
  Variables: AppContextVariables;
};

export type AppContextVariables = {
  config: DataPlaneGatewayConfig;
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
