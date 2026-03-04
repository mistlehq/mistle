import type { ServerType } from "@hono/node-server";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { AppIds, type loadConfig } from "@mistle/config";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import type { HandleIntegrationWebhookEventWorkflowInput } from "@mistle/workflows/control-plane";
import type { Context, Hono } from "hono";

import type { ControlPlaneAuth } from "./auth/index.js";
import type { SandboxInstancesService } from "./sandbox-instances/services/factory.js";
import type { SandboxProfilesService } from "./sandbox-profiles/services/factory.js";

type LoadControlPlaneApiConfigResult = ReturnType<
  typeof loadConfig<typeof AppIds.CONTROL_PLANE_API>
>;

export type ControlPlaneApiConfig = LoadControlPlaneApiConfigResult["app"];
export type ControlPlaneApiGlobalConfig = NonNullable<LoadControlPlaneApiConfigResult["global"]>;
export type ControlPlaneApiConnectionTokenConfig = {
  secret: ControlPlaneApiGlobalConfig["sandbox"]["connect"]["tokenSecret"];
  issuer: ControlPlaneApiGlobalConfig["sandbox"]["connect"]["tokenIssuer"];
  audience: ControlPlaneApiGlobalConfig["sandbox"]["connect"]["tokenAudience"];
};
export type ControlPlaneApiSandboxRuntimeConfig = {
  defaultBaseImage: ControlPlaneApiGlobalConfig["sandbox"]["defaultBaseImage"];
  gatewayWsUrl: ControlPlaneApiGlobalConfig["sandbox"]["gatewayWsUrl"];
};
export type ControlPlaneApiRuntimeConfig = {
  app: ControlPlaneApiConfig;
  internalAuthServiceToken: ControlPlaneApiGlobalConfig["internalAuth"]["serviceToken"];
  connectionToken: ControlPlaneApiConnectionTokenConfig;
  sandbox: ControlPlaneApiSandboxRuntimeConfig;
};

export type AppContextBindings = {
  Variables: AppContextVariables;
};

export type AppRoutes<BasePath> = {
  basePath: BasePath;
  routes: Hono<AppContextBindings>;
};

export type AppServices = {
  auth: ControlPlaneAuth;
  integrationWebhooks: {
    receiveWebhookEvent: (input: HandleIntegrationWebhookEventWorkflowInput) => Promise<void>;
  };
  sandboxInstances: SandboxInstancesService;
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
  sandboxConfig: ControlPlaneApiSandboxRuntimeConfig;
  internalAuthServiceToken: string;
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
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
  start: () => Promise<void>;
  stop: () => Promise<void>;
};
