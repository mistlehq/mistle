import { type StartedNetwork } from "testcontainers";

import { startControlPlaneApi, type ControlPlaneApiService } from "../apps/control-plane-api.js";
import {
  startControlPlaneWorker,
  type ControlPlaneWorkerService,
} from "../apps/control-plane-worker.js";
import { startDataPlaneApi, type DataPlaneApiService } from "../apps/data-plane-api.js";
import { startDataPlaneGateway, type DataPlaneGatewayService } from "../apps/data-plane-gateway.js";
import { startDataPlaneWorker, type DataPlaneWorkerService } from "../apps/data-plane-worker.js";
import { startTokenizerProxy, type TokenizerProxyService } from "../apps/tokenizer-proxy.js";
import { runCleanupTasks } from "../cleanup/index.js";
import { startDockerNetwork } from "../network/start-docker-network.js";
import { type StartPostgresWithPgBouncerInput } from "../services/postgres/index.js";
import { acquireSharedPostgresMailpitInfra } from "../services/shared-postgres-mailpit.js";

const OMITTED_POSTGRES_OPTIONS = [
  "network",
  "postgresNetworkAlias",
  "pgbouncerNetworkAlias",
  "manageProcessCleanup",
  "containerLabels",
] as const;

const CONTROL_PLANE_API_CONTAINER_BASE_URL = "http://control-plane-api:5100";
const DATA_PLANE_API_CONTAINER_BASE_URL = "http://data-plane-api:5200";
const DATA_PLANE_GATEWAY_CONTAINER_BASE_URL = "http://data-plane-gateway:5202";
const TOKENIZER_PROXY_CONTAINER_BASE_URL = "http://tokenizer-proxy:5205";
const DATA_PLANE_GATEWAY_TUNNEL_WS_URL = "ws://data-plane-gateway:5202/tunnel/sandbox";
const TOKENIZER_PROXY_EGRESS_BASE_URL = "http://tokenizer-proxy:5205/tokenizer-proxy/egress";

type SharedPostgresOptions = Omit<
  StartPostgresWithPgBouncerInput,
  (typeof OMITTED_POSTGRES_OPTIONS)[number]
>;

export type StartFullSystemEnvironmentInput = {
  buildContextHostPath: string;
  configPathInContainer: string;
  startupTimeoutMs: number;
  sharedInfraKey: string;
  postgres: SharedPostgresOptions;
  controlPlaneWorkflowNamespaceId: string;
  dataPlaneWorkflowNamespaceId: string;
  authBaseUrl: string;
  authInvitationAcceptBaseUrl: string;
  authTrustedOrigins: string;
  cacheBustKey?: string;
  controlPlaneApiEnvironment?: Record<string, string>;
  controlPlaneWorkerEnvironment?: Record<string, string>;
  dataPlaneApiEnvironment?: Record<string, string>;
  dataPlaneWorkerEnvironment?: Record<string, string>;
  dataPlaneGatewayEnvironment?: Record<string, string>;
  tokenizerProxyEnvironment?: Record<string, string>;
};

export type StartedFullSystemEnvironment = {
  controlPlaneApi: ControlPlaneApiService;
  controlPlaneWorker: ControlPlaneWorkerService;
  dataPlaneApi: DataPlaneApiService;
  dataPlaneWorker: DataPlaneWorkerService;
  dataPlaneGateway: DataPlaneGatewayService;
  tokenizerProxy: TokenizerProxyService;
  database: {
    hostDatabaseUrl: string;
    containerDatabaseUrl: string;
    host: string;
    port: number;
    databaseName: string;
    username: string;
    password: string;
  };
  mailpit: {
    httpBaseUrl: string;
    smtpPort: number;
  };
  containerHostGateway: string;
  stop: () => Promise<void>;
};

function createDatabaseUrl(input: {
  username: string;
  password: string;
  host: string;
  port: number;
  databaseName: string;
}): string {
  return `postgresql://${encodeURIComponent(input.username)}:${encodeURIComponent(input.password)}@${input.host}:${String(input.port)}/${input.databaseName}`;
}

export async function startFullSystemEnvironment(
  input: StartFullSystemEnvironmentInput,
): Promise<StartedFullSystemEnvironment> {
  const cleanupTasks: Array<() => Promise<void>> = [];
  let stopped = false;
  let network: StartedNetwork | undefined;

  try {
    const sharedInfraLease = await acquireSharedPostgresMailpitInfra({
      key: input.sharedInfraKey,
      postgres: input.postgres,
    });
    cleanupTasks.unshift(async () => {
      await sharedInfraLease.release();
    });

    network = await startDockerNetwork();
    cleanupTasks.unshift(async () => {
      if (network !== undefined) {
        await network.stop();
      }
    });

    const hostDatabaseUrl = createDatabaseUrl({
      username: sharedInfraLease.infra.postgres.postgres.username,
      password: sharedInfraLease.infra.postgres.postgres.password,
      host: sharedInfraLease.infra.postgres.postgres.host,
      port: sharedInfraLease.infra.postgres.postgres.port,
      databaseName: sharedInfraLease.infra.postgres.postgres.databaseName,
    });
    const containerDatabaseUrl = createDatabaseUrl({
      username: sharedInfraLease.infra.postgres.postgres.username,
      password: sharedInfraLease.infra.postgres.postgres.password,
      host: sharedInfraLease.infra.containerHostGateway,
      port: sharedInfraLease.infra.postgres.postgres.port,
      databaseName: sharedInfraLease.infra.postgres.postgres.databaseName,
    });

    const dataPlaneApi = await startDataPlaneApi({
      buildContextHostPath: input.buildContextHostPath,
      configPathInContainer: input.configPathInContainer,
      startupTimeoutMs: input.startupTimeoutMs,
      ...(input.cacheBustKey === undefined
        ? {}
        : {
            cacheBustKey: input.cacheBustKey,
          }),
      network,
      environment: {
        ...input.dataPlaneApiEnvironment,
        MISTLE_APPS_DATA_PLANE_API_DATABASE_URL: containerDatabaseUrl,
        MISTLE_APPS_DATA_PLANE_API_WORKFLOW_DATABASE_URL: containerDatabaseUrl,
        MISTLE_APPS_DATA_PLANE_API_WORKFLOW_NAMESPACE_ID: input.dataPlaneWorkflowNamespaceId,
      },
    });
    cleanupTasks.unshift(async () => {
      await dataPlaneApi.stop();
    });

    const dataPlaneGateway = await startDataPlaneGateway({
      buildContextHostPath: input.buildContextHostPath,
      configPathInContainer: input.configPathInContainer,
      startupTimeoutMs: input.startupTimeoutMs,
      ...(input.cacheBustKey === undefined
        ? {}
        : {
            cacheBustKey: input.cacheBustKey,
          }),
      network,
      environment: {
        ...input.dataPlaneGatewayEnvironment,
        MISTLE_APPS_DATA_PLANE_GATEWAY_DATABASE_URL: containerDatabaseUrl,
      },
    });
    cleanupTasks.unshift(async () => {
      await dataPlaneGateway.stop();
    });

    const dataPlaneWorker = await startDataPlaneWorker({
      buildContextHostPath: input.buildContextHostPath,
      configPathInContainer: input.configPathInContainer,
      startupTimeoutMs: input.startupTimeoutMs,
      ...(input.cacheBustKey === undefined
        ? {}
        : {
            cacheBustKey: input.cacheBustKey,
          }),
      network,
      environment: {
        ...input.dataPlaneWorkerEnvironment,
        MISTLE_APPS_DATA_PLANE_WORKER_DATABASE_URL: containerDatabaseUrl,
        MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_DATABASE_URL: containerDatabaseUrl,
        MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_NAMESPACE_ID: input.dataPlaneWorkflowNamespaceId,
        MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "false",
        MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_GATEWAY_WS_URL: DATA_PLANE_GATEWAY_TUNNEL_WS_URL,
        MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_TOKENIZER_PROXY_EGRESS_BASE_URL:
          TOKENIZER_PROXY_EGRESS_BASE_URL,
      },
    });
    cleanupTasks.unshift(async () => {
      await dataPlaneWorker.stop();
    });

    const controlPlaneApi = await startControlPlaneApi({
      buildContextHostPath: input.buildContextHostPath,
      configPathInContainer: input.configPathInContainer,
      startupTimeoutMs: input.startupTimeoutMs,
      ...(input.cacheBustKey === undefined
        ? {}
        : {
            cacheBustKey: input.cacheBustKey,
          }),
      network,
      environment: {
        ...input.controlPlaneApiEnvironment,
        MISTLE_APPS_CONTROL_PLANE_API_DATABASE_URL: containerDatabaseUrl,
        MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_DATABASE_URL: containerDatabaseUrl,
        MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_NAMESPACE_ID: input.controlPlaneWorkflowNamespaceId,
        MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL: input.authBaseUrl,
        MISTLE_APPS_CONTROL_PLANE_API_AUTH_INVITATION_ACCEPT_BASE_URL:
          input.authInvitationAcceptBaseUrl,
        MISTLE_APPS_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS: input.authTrustedOrigins,
        MISTLE_APPS_CONTROL_PLANE_API_DATA_PLANE_API_BASE_URL: DATA_PLANE_API_CONTAINER_BASE_URL,
        MISTLE_GLOBAL_SANDBOX_GATEWAY_WS_URL: DATA_PLANE_GATEWAY_TUNNEL_WS_URL,
      },
    });
    cleanupTasks.unshift(async () => {
      await controlPlaneApi.stop();
    });

    const controlPlaneWorker = await startControlPlaneWorker({
      buildContextHostPath: input.buildContextHostPath,
      configPathInContainer: input.configPathInContainer,
      startupTimeoutMs: input.startupTimeoutMs,
      ...(input.cacheBustKey === undefined
        ? {}
        : {
            cacheBustKey: input.cacheBustKey,
          }),
      network,
      environment: {
        ...input.controlPlaneWorkerEnvironment,
        MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_DATABASE_URL: containerDatabaseUrl,
        MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_NAMESPACE_ID:
          input.controlPlaneWorkflowNamespaceId,
        MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "false",
        MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_HOST: sharedInfraLease.infra.containerHostGateway,
        MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PORT: String(sharedInfraLease.infra.mailpit.smtpPort),
        MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_SECURE: "false",
        MISTLE_APPS_CONTROL_PLANE_WORKER_DATA_PLANE_API_BASE_URL: DATA_PLANE_API_CONTAINER_BASE_URL,
        MISTLE_APPS_CONTROL_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL:
          CONTROL_PLANE_API_CONTAINER_BASE_URL,
      },
    });
    cleanupTasks.unshift(async () => {
      await controlPlaneWorker.stop();
    });

    const tokenizerProxy = await startTokenizerProxy({
      buildContextHostPath: input.buildContextHostPath,
      configPathInContainer: input.configPathInContainer,
      startupTimeoutMs: input.startupTimeoutMs,
      ...(input.cacheBustKey === undefined
        ? {}
        : {
            cacheBustKey: input.cacheBustKey,
          }),
      network,
      environment: {
        ...input.tokenizerProxyEnvironment,
        MISTLE_APPS_TOKENIZER_PROXY_CONTROL_PLANE_API_BASE_URL:
          CONTROL_PLANE_API_CONTAINER_BASE_URL,
      },
    });
    cleanupTasks.unshift(async () => {
      await tokenizerProxy.stop();
    });

    return {
      controlPlaneApi,
      controlPlaneWorker,
      dataPlaneApi,
      dataPlaneWorker,
      dataPlaneGateway,
      tokenizerProxy,
      database: {
        hostDatabaseUrl,
        containerDatabaseUrl,
        host: sharedInfraLease.infra.postgres.postgres.host,
        port: sharedInfraLease.infra.postgres.postgres.port,
        databaseName: sharedInfraLease.infra.postgres.postgres.databaseName,
        username: sharedInfraLease.infra.postgres.postgres.username,
        password: sharedInfraLease.infra.postgres.postgres.password,
      },
      mailpit: {
        httpBaseUrl: sharedInfraLease.infra.mailpit.httpBaseUrl,
        smtpPort: sharedInfraLease.infra.mailpit.smtpPort,
      },
      containerHostGateway: sharedInfraLease.infra.containerHostGateway,
      stop: async () => {
        if (stopped) {
          throw new Error("Full system environment was already stopped.");
        }

        stopped = true;
        await runCleanupTasks({
          tasks: cleanupTasks,
          context: "full system environment cleanup",
        });
      },
    };
  } catch (error) {
    await runCleanupTasks({
      tasks: cleanupTasks,
      context: "full system environment setup rollback",
    });
    throw error;
  }
}

export const FullSystemContainerBaseUrls = {
  CONTROL_PLANE_API: CONTROL_PLANE_API_CONTAINER_BASE_URL,
  DATA_PLANE_API: DATA_PLANE_API_CONTAINER_BASE_URL,
  DATA_PLANE_GATEWAY: DATA_PLANE_GATEWAY_CONTAINER_BASE_URL,
  TOKENIZER_PROXY: TOKENIZER_PROXY_CONTAINER_BASE_URL,
} as const;
