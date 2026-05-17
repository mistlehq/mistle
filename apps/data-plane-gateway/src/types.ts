import type { ServerType } from "@hono/node-server";
import { AppIds, type loadConfig } from "@mistle/config";
import type { DataPlaneDatabase, DataPlaneTables } from "@mistle/db/data-plane";
import type { Context, Hono } from "hono";

import type { DirectEgressAdmission } from "./egress/direct-egress-proxy-service.js";
import type { GatewayEgressTransportService } from "./egress/egress-transport-service.js";
import type { PortAccessNodeEntrypoint } from "./publishing/port-access-node-entrypoint.js";
import type { PortAccessTransportService } from "./publishing/port-access-transport.js";
import type { PortsTargetAuthorizeService } from "./publishing/ports-target-authorize-service.js";
import type { AdmittedSandboxTunnelWebSocketRequest } from "./tunnel/admission/sandbox-tunnel-websocket-admission.js";

type LoadDataPlaneGatewayConfigResult = ReturnType<
  typeof loadConfig<typeof AppIds.DATA_PLANE_GATEWAY>
>;

export type DataPlaneGatewayConfig = LoadDataPlaneGatewayConfigResult["app"] & {
  /**
   * Programmatic test-only isolation switch.
   *
   * This is intentionally not part of the public config schema or env loader,
   * so deployment config cannot enable it accidentally. The integration harness
   * sets it directly when a pooled gateway must select a per-test database
   * schema from the test environment id on each request.
   */
  __dangerouslyEnableTestIsolation?: {
    testEnvironmentIdHeader: string;
  };
};
export type DataPlaneGatewayRuntimeConfig = {
  app: DataPlaneGatewayConfig;
};

export type AppContextBindings = {
  Variables: AppContextVariables;
};

export type AppContextVariables = {
  config: DataPlaneGatewayConfig;
  db: DataPlaneDatabase;
  tables: DataPlaneTables;
  testEnvironmentId?: string;
  directEgressAdmission?: DirectEgressAdmission;
  sandboxTunnelAdmission?: AdmittedSandboxTunnelWebSocketRequest;
};

export type AppContext = Context<AppContextBindings>;
export type DataPlaneGatewayApp = Hono<AppContextBindings>;

export type StartServerInput = {
  app: DataPlaneGatewayApp;
  host: string;
  port: number;
  portAccessNodeEntrypoint?: PortAccessNodeEntrypoint;
};

export type StartedServer = {
  server: ServerType;
  close: () => Promise<void>;
};

export type DataPlaneGatewayRuntime = {
  app: DataPlaneGatewayApp;
  internals: {
    gatewayEgressTransportService: GatewayEgressTransportService;
    portAccessTransportService: PortAccessTransportService;
    portsTargetAuthorizeService: PortsTargetAuthorizeService;
  };
  request: (path: string, init?: RequestInit) => Promise<Response>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};
