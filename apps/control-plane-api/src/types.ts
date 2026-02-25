import type { ServerType } from "@hono/node-server";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { Context, Hono } from "hono";

import { AppIds, type loadConfig } from "@mistle/config";

import type { ControlPlaneAuth } from "./auth/index.js";
import type { SandboxProfilesService } from "./sandbox-profiles/services/factory.js";

type LoadControlPlaneApiConfigResult = ReturnType<
  typeof loadConfig<typeof AppIds.CONTROL_PLANE_API>
>;

export type ControlPlaneApiConfig = LoadControlPlaneApiConfigResult["app"];

export type AppContextBindings = {
  Variables: AppContextVariables;
};

export type AppRoutes<BasePath> = {
  basePath: BasePath;
  routes: Hono<AppContextBindings>;
};

export type AppServices = {
  auth: ControlPlaneAuth;
  sandboxProfiles: SandboxProfilesService;
};

export type AppSession = {
  user: {
    id: string;
  };
  session: {
    id: string;
    userId: string;
    activeOrganizationId: string;
  };
};

export type AppContextVariables = {
  config: ControlPlaneApiConfig;
  db: ControlPlaneDatabase;
  services: AppServices;
  session: AppSession | null;
};

export type AppContext = Context<AppContextBindings>;
export type ControlPlaneApp = OpenAPIHono<AppContextBindings>;

export type StartServerInput = {
  app: ControlPlaneApp;
  host: string;
  port: number;
};

export type StartedServer = {
  server: ServerType;
  close: () => Promise<void>;
};

export type ControlPlaneApiRuntime = {
  app: ControlPlaneApp;
  db: ControlPlaneDatabase;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  start: () => void;
  stop: () => Promise<void>;
};
