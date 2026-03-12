import { startControlPlaneApi, type ControlPlaneApiService } from "../apps/control-plane-api.js";
import {
  startControlPlaneWorker,
  type ControlPlaneWorkerService,
} from "../apps/control-plane-worker.js";
import { runCleanupTasks } from "../cleanup/index.js";
import { type StartPostgresWithPgBouncerInput } from "../services/postgres/index.js";
import { acquireSharedPostgresMailpitInfra } from "../services/shared-postgres-mailpit.js";

const OMITTED_POSTGRES_OPTIONS = [
  "network",
  "postgresNetworkAlias",
  "pgbouncerNetworkAlias",
  "manageProcessCleanup",
  "containerLabels",
] as const;

export const DEFAULT_SHARED_SYSTEM_INFRA_KEY = "mistle-system-shared-v1";
const CONTROL_PLANE_API_CONTAINER_BASE_URL = "http://control-plane-api:5100";

type SharedPostgresOptions = Omit<
  StartPostgresWithPgBouncerInput,
  (typeof OMITTED_POSTGRES_OPTIONS)[number]
>;

export type StartControlPlaneSystemEnvironmentInput = {
  buildContextHostPath: string;
  configPathInContainer: string;
  startupTimeoutMs: number;
  sharedInfraKey: string;
  postgres: SharedPostgresOptions;
  workflowNamespaceId: string;
  authBaseUrl: string;
  dashboardBaseUrl: string;
  authTrustedOrigins: string;
  cacheBustKey?: string;
  controlPlaneApiEnvironment?: Record<string, string>;
  controlPlaneWorkerEnvironment?: Record<string, string>;
};

export type StartedControlPlaneSystemEnvironment = {
  controlPlaneApi: ControlPlaneApiService;
  controlPlaneWorker: ControlPlaneWorkerService;
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

export async function startControlPlaneSystemEnvironment(
  input: StartControlPlaneSystemEnvironmentInput,
): Promise<StartedControlPlaneSystemEnvironment> {
  const cleanupTasks: Array<() => Promise<void>> = [];
  let stopped = false;

  try {
    const sharedInfraLease = await acquireSharedPostgresMailpitInfra({
      key: input.sharedInfraKey,
      postgres: input.postgres,
    });
    cleanupTasks.unshift(async () => {
      await sharedInfraLease.release();
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

    const controlPlaneApi = await startControlPlaneApi({
      buildContextHostPath: input.buildContextHostPath,
      configPathInContainer: input.configPathInContainer,
      startupTimeoutMs: input.startupTimeoutMs,
      ...(input.cacheBustKey === undefined
        ? {}
        : {
            cacheBustKey: input.cacheBustKey,
          }),
      environment: {
        ...input.controlPlaneApiEnvironment,
        MISTLE_APPS_CONTROL_PLANE_API_DATABASE_URL: containerDatabaseUrl,
        MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_DATABASE_URL: containerDatabaseUrl,
        MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_NAMESPACE_ID: input.workflowNamespaceId,
        MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL: input.authBaseUrl,
        MISTLE_APPS_CONTROL_PLANE_API_DASHBOARD_BASE_URL: input.dashboardBaseUrl,
        MISTLE_APPS_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS: input.authTrustedOrigins,
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
      environment: {
        ...input.controlPlaneWorkerEnvironment,
        MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_DATABASE_URL: containerDatabaseUrl,
        MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_NAMESPACE_ID: input.workflowNamespaceId,
        MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "false",
        MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_HOST: sharedInfraLease.infra.containerHostGateway,
        MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PORT: String(sharedInfraLease.infra.mailpit.smtpPort),
        MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_SECURE: "false",
        MISTLE_APPS_CONTROL_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL:
          CONTROL_PLANE_API_CONTAINER_BASE_URL,
      },
    });
    cleanupTasks.unshift(async () => {
      await controlPlaneWorker.stop();
    });

    return {
      controlPlaneApi,
      controlPlaneWorker,
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
          throw new Error("Control-plane system environment was already stopped.");
        }

        stopped = true;
        await runCleanupTasks({
          tasks: cleanupTasks,
          context: "control-plane system environment cleanup",
        });
      },
    };
  } catch (error) {
    await runCleanupTasks({
      tasks: cleanupTasks,
      context: "control-plane system environment setup rollback",
    });
    throw error;
  }
}
