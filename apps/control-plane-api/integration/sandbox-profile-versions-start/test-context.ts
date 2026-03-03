import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

import { CONTROL_PLANE_SCHEMA_NAME, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import {
  runCleanupTasks,
  startDataPlaneApi,
  startDataPlaneGateway,
  startDataPlaneWorker,
  startControlPlaneWorker,
  startDockerNetwork,
  startMailpit,
  startPostgresWithPgBouncer,
} from "@mistle/test-harness";
import { Pool } from "pg";
import { it as vitestIt } from "vitest";

import { createControlPlaneApiRuntime } from "../../src/runtime/index.js";
import type { AuthenticatedSession } from "../helpers/auth-session.js";
import { createAuthenticatedSession } from "../helpers/auth-session.js";

export type StartSandboxIntegrationFixture = {
  controlPlaneDb: ControlPlaneDatabase;
  dataPlaneDb: DataPlaneDatabase;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authSession: (input?: { email?: string }) => Promise<AuthenticatedSession>;
};

const PROJECT_ROOT_HOST_PATH = fileURLToPath(new URL("../../../../", import.meta.url));
const CONFIG_PATH_IN_CONTAINER = "/workspace/config/config.development.toml";
const APP_STARTUP_TIMEOUT_MS = 120_000;
const CONTROL_PLANE_POSTGRES_NETWORK_ALIAS = "control-plane-postgres";
const CONTROL_PLANE_POSTGRES_PORT_IN_NETWORK = 5432;
const CONTROL_PLANE_PGBOUNCER_NETWORK_ALIAS = "control-plane-pgbouncer";
const DATA_PLANE_POSTGRES_NETWORK_ALIAS = "data-plane-postgres";
const DATA_PLANE_POSTGRES_PORT_IN_NETWORK = 5432;
const DATA_PLANE_PGBOUNCER_NETWORK_ALIAS = "data-plane-pgbouncer";
const MAILPIT_NETWORK_ALIAS = "mailpit";
const MAILPIT_SMTP_PORT_IN_NETWORK = 1025;
const SANDBOX_BASE_IMAGE_REF = "mistle/sandbox-base:dev";
const SANDBOX_BASE_IMAGE_REPOSITORY = "mistle/sandbox-base";
const LOCAL_REGISTRY_CONTAINER_PORT = "5000/tcp";
const LOCAL_REGISTRY_HOST = "127.0.0.1";

function runProcess(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], (error) => {
      if (error !== null) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function runProcessWithOutput(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], (error, stdout, stderr) => {
      if (error !== null) {
        reject(
          new Error(
            `Command failed: ${command} ${args.join(" ")}\nstdout: ${stdout}\nstderr: ${stderr}`,
          ),
        );
        return;
      }

      resolve(stdout);
    });
  });
}

async function ensureSandboxBaseImage(projectRootHostPath: string): Promise<void> {
  await runProcess("docker", [
    "build",
    "--target",
    "sandbox-base-dev",
    "-f",
    `${projectRootHostPath}/apps/sandbox-runtime/images/base/Dockerfile`,
    "-t",
    SANDBOX_BASE_IMAGE_REF,
    projectRootHostPath,
  ]);
}

function parseDockerPublishedPort(dockerPortOutput: string): number {
  const [firstLine = ""] = dockerPortOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const portMatch = firstLine.match(/:(\d+)$/u);
  if (portMatch === null) {
    throw new Error(`Unable to parse local registry port from docker output: ${dockerPortOutput}`);
  }

  const matchedPort = portMatch[1];
  if (matchedPort === undefined) {
    throw new Error(`Unable to parse matched port from docker output: ${dockerPortOutput}`);
  }

  const parsedPort = Number.parseInt(matchedPort, 10);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error(`Parsed an invalid local registry port: ${String(parsedPort)}`);
  }

  return parsedPort;
}

async function startLocalRegistry(): Promise<{
  host: string;
  port: number;
  stop: () => Promise<void>;
}> {
  const registryContainerId = (
    await runProcessWithOutput("docker", [
      "run",
      "--detach",
      "--publish",
      `${LOCAL_REGISTRY_HOST}::5000`,
      "registry:2",
    ])
  ).trim();

  if (registryContainerId.length === 0) {
    throw new Error("Failed to start local Docker registry container.");
  }

  const publishedPortOutput = await runProcessWithOutput("docker", [
    "port",
    registryContainerId,
    LOCAL_REGISTRY_CONTAINER_PORT,
  ]);
  const registryPort = parseDockerPublishedPort(publishedPortOutput);

  return {
    host: LOCAL_REGISTRY_HOST,
    port: registryPort,
    stop: async () => {
      await runProcess("docker", ["rm", "--force", registryContainerId]);
    },
  };
}

async function startRegistryAndPublishSandboxBaseImage(projectRootHostPath: string): Promise<{
  imageRef: string;
  stopRegistry: () => Promise<void>;
}> {
  await ensureSandboxBaseImage(projectRootHostPath);

  const registry = await startLocalRegistry();
  try {
    const publishedImageRef = `${registry.host}:${String(registry.port)}/${SANDBOX_BASE_IMAGE_REPOSITORY}:dev`;
    await runProcess("docker", ["tag", SANDBOX_BASE_IMAGE_REF, publishedImageRef]);
    await runProcess("docker", ["push", publishedImageRef]);

    return {
      imageRef: publishedImageRef,
      stopRegistry: registry.stop,
    };
  } catch (error) {
    await registry.stop();
    throw error;
  }
}

function toWsBaseUrl(httpBaseUrl: string): string {
  return httpBaseUrl.replace(/^http/u, "ws");
}

function createDockerHostGatewayWsUrl(port: number): string {
  return `ws://host.docker.internal:${String(port)}/tunnel/sandbox`;
}

function createDatabaseUrl(input: {
  username: string;
  password: string;
  host: string;
  port: number;
  databaseName: string;
}): string {
  return `postgresql://${encodeURIComponent(input.username)}:${encodeURIComponent(input.password)}@${input.host}:${String(input.port)}/${input.databaseName}`;
}

export const it = vitestIt.extend<{ fixture: StartSandboxIntegrationFixture }>({
  fixture: [
    async ({ task }, use) => {
      void task;
      const cleanupTasks: Array<() => Promise<void>> = [];

      try {
        const internalAuthServiceToken = "integration-service-token";
        const workflowNamespaceId = "integration";
        const publishedSandboxBaseImage =
          await startRegistryAndPublishSandboxBaseImage(PROJECT_ROOT_HOST_PATH);
        cleanupTasks.unshift(async () => {
          await publishedSandboxBaseImage.stopRegistry();
        });

        const network = await startDockerNetwork();
        cleanupTasks.unshift(async () => {
          await network.stop();
        });

        const controlPlaneDatabaseStack = await startPostgresWithPgBouncer({
          databaseName: "mistle_control_plane_start_instance_integration",
          network,
          postgresNetworkAlias: CONTROL_PLANE_POSTGRES_NETWORK_ALIAS,
          pgbouncerNetworkAlias: CONTROL_PLANE_PGBOUNCER_NETWORK_ALIAS,
        });
        cleanupTasks.unshift(async () => {
          await controlPlaneDatabaseStack.stop();
        });
        await runControlPlaneMigrations({
          connectionString: controlPlaneDatabaseStack.directUrl,
          schemaName: CONTROL_PLANE_SCHEMA_NAME,
          migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
          migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
          migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
        });

        const dataPlaneDatabaseStack = await startPostgresWithPgBouncer({
          databaseName: "mistle_data_plane_start_instance_integration",
          network,
          postgresNetworkAlias: DATA_PLANE_POSTGRES_NETWORK_ALIAS,
          pgbouncerNetworkAlias: DATA_PLANE_PGBOUNCER_NETWORK_ALIAS,
        });
        cleanupTasks.unshift(async () => {
          await dataPlaneDatabaseStack.stop();
        });
        await runDataPlaneMigrations({
          connectionString: dataPlaneDatabaseStack.directUrl,
          schemaName: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
          migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
          migrationsSchema: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
          migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
        });

        const dataPlaneDbPool = new Pool({
          connectionString: dataPlaneDatabaseStack.directUrl,
        });
        cleanupTasks.unshift(async () => {
          await dataPlaneDbPool.end();
        });
        const dataPlaneDb = createDataPlaneDatabase(dataPlaneDbPool);

        const directDataPlaneDatabaseUrlInNetwork = createDatabaseUrl({
          username: dataPlaneDatabaseStack.postgres.username,
          password: dataPlaneDatabaseStack.postgres.password,
          host: DATA_PLANE_POSTGRES_NETWORK_ALIAS,
          port: DATA_PLANE_POSTGRES_PORT_IN_NETWORK,
          databaseName: dataPlaneDatabaseStack.postgres.databaseName,
        });
        const pooledDataPlaneDatabaseUrlInNetwork = createDatabaseUrl({
          username: dataPlaneDatabaseStack.postgres.username,
          password: dataPlaneDatabaseStack.postgres.password,
          host: DATA_PLANE_PGBOUNCER_NETWORK_ALIAS,
          port: DATA_PLANE_POSTGRES_PORT_IN_NETWORK,
          databaseName: dataPlaneDatabaseStack.postgres.databaseName,
        });

        const dataPlaneApiService = await startDataPlaneApi({
          buildContextHostPath: PROJECT_ROOT_HOST_PATH,
          configPathInContainer: CONFIG_PATH_IN_CONTAINER,
          startupTimeoutMs: APP_STARTUP_TIMEOUT_MS,
          network,
          environment: {
            MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN: internalAuthServiceToken,
            MISTLE_APPS_DATA_PLANE_API_DATABASE_URL: pooledDataPlaneDatabaseUrlInNetwork,
            MISTLE_APPS_DATA_PLANE_API_WORKFLOW_DATABASE_URL: pooledDataPlaneDatabaseUrlInNetwork,
            MISTLE_APPS_DATA_PLANE_API_WORKFLOW_NAMESPACE_ID: workflowNamespaceId,
          },
        });
        cleanupTasks.unshift(async () => {
          await dataPlaneApiService.stop();
        });

        const dataPlaneGatewayService = await startDataPlaneGateway({
          buildContextHostPath: PROJECT_ROOT_HOST_PATH,
          configPathInContainer: CONFIG_PATH_IN_CONTAINER,
          startupTimeoutMs: APP_STARTUP_TIMEOUT_MS,
          network,
          environment: {
            MISTLE_APPS_DATA_PLANE_GATEWAY_DATABASE_URL: pooledDataPlaneDatabaseUrlInNetwork,
          },
        });
        cleanupTasks.unshift(async () => {
          await dataPlaneGatewayService.stop();
        });

        const dataPlaneWorkerService = await startDataPlaneWorker({
          buildContextHostPath: PROJECT_ROOT_HOST_PATH,
          configPathInContainer: CONFIG_PATH_IN_CONTAINER,
          startupTimeoutMs: APP_STARTUP_TIMEOUT_MS,
          network,
          environment: {
            MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN: internalAuthServiceToken,
            MISTLE_APPS_DATA_PLANE_WORKER_DATABASE_URL: directDataPlaneDatabaseUrlInNetwork,
            MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_DATABASE_URL:
              directDataPlaneDatabaseUrlInNetwork,
            MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_NAMESPACE_ID: workflowNamespaceId,
            MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "false",
            MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_GATEWAY_WS_URL: createDockerHostGatewayWsUrl(
              dataPlaneGatewayService.mappedPort,
            ),
          },
        });
        cleanupTasks.unshift(async () => {
          await dataPlaneWorkerService.stop();
        });

        const mailpitService = await startMailpit({
          network,
          networkAlias: MAILPIT_NETWORK_ALIAS,
        });
        cleanupTasks.unshift(async () => {
          await mailpitService.stop();
        });

        const directControlPlaneDatabaseUrlInNetwork = createDatabaseUrl({
          username: controlPlaneDatabaseStack.postgres.username,
          password: controlPlaneDatabaseStack.postgres.password,
          host: CONTROL_PLANE_POSTGRES_NETWORK_ALIAS,
          port: CONTROL_PLANE_POSTGRES_PORT_IN_NETWORK,
          databaseName: controlPlaneDatabaseStack.postgres.databaseName,
        });
        const controlPlaneWorkerService = await startControlPlaneWorker({
          buildContextHostPath: PROJECT_ROOT_HOST_PATH,
          configPathInContainer: CONFIG_PATH_IN_CONTAINER,
          startupTimeoutMs: APP_STARTUP_TIMEOUT_MS,
          network,
          environment: {
            MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN: internalAuthServiceToken,
            MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_DATABASE_URL:
              directControlPlaneDatabaseUrlInNetwork,
            MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_NAMESPACE_ID: workflowNamespaceId,
            MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "true",
            MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_HOST: MAILPIT_NETWORK_ALIAS,
            MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PORT: String(MAILPIT_SMTP_PORT_IN_NETWORK),
            MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_SECURE: "false",
            MISTLE_APPS_CONTROL_PLANE_WORKER_DATA_PLANE_API_BASE_URL:
              dataPlaneApiService.containerBaseUrl,
          },
        });
        cleanupTasks.unshift(async () => {
          await controlPlaneWorkerService.stop();
        });

        const controlPlaneConfig = {
          server: {
            host: "127.0.0.1",
            port: 3000,
          },
          database: {
            url: controlPlaneDatabaseStack.pooledUrl,
          },
          workflow: {
            databaseUrl: controlPlaneDatabaseStack.pooledUrl,
            namespaceId: workflowNamespaceId,
          },
          dataPlaneApi: {
            baseUrl: dataPlaneApiService.hostBaseUrl,
          },
          sandbox: {
            defaultBaseImage: publishedSandboxBaseImage.imageRef,
            gatewayWsUrl: `${toWsBaseUrl(dataPlaneGatewayService.hostBaseUrl)}/tunnel/sandbox`,
          },
          integrations: {
            activeMasterEncryptionKeyVersion: 1,
            masterEncryptionKeys: {
              "1": "integration-master-key-testing",
            },
          },
          auth: {
            baseUrl: "http://localhost:3000",
            invitationAcceptBaseUrl: "http://localhost:5173/invitations/accept",
            secret: "integration-auth-secret",
            trustedOrigins: ["http://localhost:3000"],
            otpLength: 6,
            otpExpiresInSeconds: 300,
            otpAllowedAttempts: 3,
          },
        };
        const controlPlaneRuntime = await createControlPlaneApiRuntime({
          app: controlPlaneConfig,
          internalAuthServiceToken,
          connectionToken: {
            secret: "integration-connection-secret",
            issuer: "integration-issuer",
            audience: "integration-audience",
          },
        });
        cleanupTasks.unshift(async () => {
          await controlPlaneRuntime.stop();
        });

        await use({
          controlPlaneDb: controlPlaneRuntime.db,
          dataPlaneDb,
          request: controlPlaneRuntime.request,
          authSession: async (input) =>
            createAuthenticatedSession({
              request: controlPlaneRuntime.request,
              db: controlPlaneRuntime.db,
              mailpitService,
              otpLength: controlPlaneConfig.auth.otpLength,
              ...(input?.email === undefined ? {} : { email: input.email }),
            }),
        });
      } finally {
        await runCleanupTasks({
          tasks: cleanupTasks,
          context: "control-plane-api sandbox-profile-versions fixture cleanup",
        });
      }
    },
    {
      scope: "file",
    },
  ],
});
