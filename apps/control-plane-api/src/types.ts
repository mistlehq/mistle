import type { IncomingMessage, ServerResponse } from "node:http";

import type { ServerType } from "@hono/node-server";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { AppIds, type loadConfig } from "@mistle/config";
import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import type { S3CompatibleObjectStore } from "@mistle/object-store";
import type { Context, Hono } from "hono";
import type { OpenWorkflow } from "openworkflow";

import type { ControlPlaneAuth } from "./auth/index.js";
import type { GoogleProviderConfig } from "./auth/providers/types.js";
import type { OrganizationPermission } from "./auth/services/organization-policy.js";

type LoadControlPlaneApiConfigResult = ReturnType<
  typeof loadConfig<typeof AppIds.CONTROL_PLANE_API>
>;

export type ControlPlaneApiConfig = LoadControlPlaneApiConfigResult["app"] & {
  __dangerouslyEnableTestIsolation?: {
    testEnvironmentIdHeader: string;
    googleAuth?: GoogleProviderConfig;
  };
};
export type ControlPlaneApiGlobalConfig = NonNullable<LoadControlPlaneApiConfigResult["global"]>;
export type ControlPlaneApiConnectionTokenConfig = ControlPlaneApiConfig["connectionToken"];
export type ControlPlaneApiMcpConfig = ControlPlaneApiConfig["mcp"];
export type ControlPlaneApiPortAccessConfig = ControlPlaneApiConfig["portAccess"];
export type ControlPlaneApiPtyTransportConfig = ControlPlaneApiConfig["ptyTransport"];
export type ControlPlaneApiSandboxRuntimeConfig = ControlPlaneApiConfig["sandbox"];
export type ControlPlaneApiRuntimeConfig = {
  app: ControlPlaneApiConfig;
  global: Pick<ControlPlaneApiGlobalConfig, "env">;
};

export type AppContextBindings = {
  Variables: AppContextVariables;
};

export type AppRoutes<BasePath> = {
  basePath: BasePath;
  routes: Hono<AppContextBindings>;
};

export type AppSession = {
  user: {
    id: string;
  };
  activeOrganizationId: string;
  session: {
    id: string;
    userId: string;
    activeOrganizationId: string;
  };
};

export type AppAuthContext =
  | {
      kind: "session";
      session: AppSession;
    }
  | {
      kind: "api_key";
      apiKey: {
        id: string;
        name: string;
        organizationId: string;
      };
      permissions: readonly OrganizationPermission[];
    }
  | {
      kind: "mcp_capability";
      organizationId: string;
      capability: {
        kind: "setup_assistant";
        sandboxInstanceId: string;
        sandboxProfileId: string;
        sandboxProfileVersion: number;
      };
      permissions: readonly OrganizationPermission[];
    };

export type AppOrganizationActor =
  | {
      kind: "user";
      userId: string;
      sessionId: string;
      organizationId: string;
      permissions: readonly OrganizationPermission[];
    }
  | {
      kind: "api_key";
      apiKeyId: string;
      name: string;
      organizationId: string;
      permissions: readonly OrganizationPermission[];
    }
  | {
      kind: "mcp_capability";
      organizationId: string;
      capability: {
        kind: "setup_assistant";
        sandboxInstanceId: string;
        sandboxProfileId: string;
        sandboxProfileVersion: number;
      };
      permissions: readonly OrganizationPermission[];
    };

export type AppContextVariables = {
  config: ControlPlaneApiConfig;
  sandboxConfig: ControlPlaneApiSandboxRuntimeConfig;
  internalAuthServiceToken: string;
  db: ControlPlaneDatabase;
  objectStore: S3CompatibleObjectStore;
  integrationRegistry: IntegrationRegistry;
  dataPlaneClient: DataPlaneSandboxInstancesClient;
  connectionTokenConfig: ControlPlaneApiConnectionTokenConfig;
  portAccessConfig: ControlPlaneApiPortAccessConfig;
  ptyTransportConfig: ControlPlaneApiPtyTransportConfig;
  openWorkflow: OpenWorkflow;
  auth: ControlPlaneAuth;
  session: AppSession | null;
  authContext: AppAuthContext | null;
  organizationActor: AppOrganizationActor | null;
};

export type AppContext = Context<AppContextBindings>;
export type ControlPlaneApp = OpenAPIHono<AppContextBindings>;

export type StartServerInput = {
  app: ControlPlaneApp;
  host: string;
  port: number;
  nodeRequestHandlers?: readonly NodeRequestHandler[];
};

export type StartedServer = {
  server: ServerType;
  close: () => Promise<void>;
};

export type NodeRequestHandler = {
  matches: (request: IncomingMessage) => boolean;
  handle: (request: IncomingMessage, response: ServerResponse) => Promise<void> | void;
};

export type ControlPlaneApiRuntime = {
  app: ControlPlaneApp;
  db: ControlPlaneDatabase;
  request: (path: string, init?: RequestInit) => Response | Promise<Response>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};
