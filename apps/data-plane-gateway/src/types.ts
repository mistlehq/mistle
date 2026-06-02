import type { ServerType } from "@hono/node-server";
import { AppIds, type loadConfig } from "@mistle/config";
import type { DataPlaneDatabase, DataPlaneTables } from "@mistle/db/data-plane";
import type { Context, Hono } from "hono";

import type { DirectEgressAdmission } from "./egress/direct-egress-proxy-service.js";
import type { PtyTransportAdmission } from "./pty/pty-transport-service.js";
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
  /**
   * Programmatic test-only CA trust for direct egress upstream TLS.
   *
   * This is intentionally not part of public deployment config. Runtime system
   * tests use it when a local simulated upstream serves TLS with an ephemeral CA.
   */
  __dangerouslyTrustDirectEgressTlsCaCertificates?: readonly string[];
  /**
   * Programmatic test-only delay for direct egress websocket upstream
   * resolution.
   *
   * This is intentionally not part of public deployment config. Integration
   * tests use it to make gateway restart races deterministic while preserving
   * the production route and service stack.
   */
  __dangerouslyDelayDirectEgressWebSocketUpstreamResolutionMs?: number;
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
  ptyTransportAdmission?: PtyTransportAdmission;
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
  close: (options?: StartedServerCloseOptions) => Promise<StartedServerCloseResult>;
};

export type StartedServerCloseOptions = {
  forceAfterMs?: number;
};

export type StartedServerCloseResult = {
  forcedConnectionClose: boolean;
};

export type DataPlaneGatewayRuntime = {
  app: DataPlaneGatewayApp;
  internals: {
    portAccessTransportService: PortAccessTransportService;
    portsTargetAuthorizeService: PortsTargetAuthorizeService;
  };
  request: (path: string, init?: RequestInit) => Promise<Response>;
  startDrain: () => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};
