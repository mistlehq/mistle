import { fileURLToPath } from "node:url";

import { CONTROL_PLANE_SCHEMA_NAME, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";
import {
  runCleanupTasks,
  startControlPlaneWorker,
  startDockerNetwork,
  startMailpit,
  startPostgresWithPgBouncer,
  type MailpitService,
  type PostgresWithPgBouncerService,
} from "@mistle/test-harness";
import { it as vitestIt } from "vitest";

import { createControlPlaneApiRuntime } from "../src/runtime/index.js";
import type { ControlPlaneApiConfig } from "../src/types.js";
import type { AuthenticatedSession } from "./helpers/auth-session.js";
import { createAuthenticatedSession } from "./helpers/auth-session.js";

const PROJECT_ROOT_HOST_PATH = fileURLToPath(new URL("../../..", import.meta.url));
const CONFIG_PATH_IN_CONTAINER = "/workspace/config/config.development.toml";
const APP_STARTUP_TIMEOUT_MS = 120_000;
const POSTGRES_NETWORK_ALIAS = "control-plane-postgres";
const POSTGRES_PORT_IN_NETWORK = 5432;
const PGBOUNCER_NETWORK_ALIAS = "control-plane-pgbouncer";
const MAILPIT_NETWORK_ALIAS = "mailpit";
const MAILPIT_SMTP_PORT_IN_NETWORK = 1025;

function createDatabaseUrl(input: {
  username: string;
  password: string;
  host: string;
  port: number;
  databaseName: string;
}): string {
  return `postgresql://${encodeURIComponent(input.username)}:${encodeURIComponent(input.password)}@${input.host}:${String(input.port)}/${input.databaseName}`;
}

export type ControlPlaneApiIntegrationFixture = {
  config: ControlPlaneApiConfig;
  internalAuthServiceToken: string;
  db: ControlPlaneDatabase;
  mailpitService: MailpitService;
  databaseStack: PostgresWithPgBouncerService;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authSession: (input?: { email?: string }) => Promise<AuthenticatedSession>;
};

export const it = vitestIt.extend<{ fixture: ControlPlaneApiIntegrationFixture }>({
  fixture: [
    async ({}, use) => {
      const cleanupTasks: Array<() => Promise<void>> = [];

      try {
        const network = await startDockerNetwork();
        cleanupTasks.unshift(async () => {
          await network.stop();
        });

        const databaseStack = await startPostgresWithPgBouncer({
          databaseName: "mistle_control_plane_api_integration",
          network,
          postgresNetworkAlias: POSTGRES_NETWORK_ALIAS,
          pgbouncerNetworkAlias: PGBOUNCER_NETWORK_ALIAS,
        });
        cleanupTasks.unshift(async () => {
          await databaseStack.stop();
        });

        const mailpitService = await startMailpit({
          network,
          networkAlias: MAILPIT_NETWORK_ALIAS,
        });
        cleanupTasks.unshift(async () => {
          await mailpitService.stop();
        });

        await runControlPlaneMigrations({
          connectionString: databaseStack.directUrl,
          schemaName: CONTROL_PLANE_SCHEMA_NAME,
          migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
          migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
          migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
        });

        const workflowNamespaceId = "integration";
        const internalAuthServiceToken = "integration-service-token";
        const directDatabaseUrlInNetwork = createDatabaseUrl({
          username: databaseStack.postgres.username,
          password: databaseStack.postgres.password,
          host: POSTGRES_NETWORK_ALIAS,
          port: POSTGRES_PORT_IN_NETWORK,
          databaseName: databaseStack.postgres.databaseName,
        });

        const workerService = await startControlPlaneWorker({
          buildContextHostPath: PROJECT_ROOT_HOST_PATH,
          configPathInContainer: CONFIG_PATH_IN_CONTAINER,
          startupTimeoutMs: APP_STARTUP_TIMEOUT_MS,
          network,
          environment: {
            MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN: internalAuthServiceToken,
            MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_DATABASE_URL: directDatabaseUrlInNetwork,
            MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_NAMESPACE_ID: workflowNamespaceId,
            MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "true",
            MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_HOST: MAILPIT_NETWORK_ALIAS,
            MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PORT: String(MAILPIT_SMTP_PORT_IN_NETWORK),
            MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_SECURE: "false",
          },
        });
        cleanupTasks.unshift(async () => {
          await workerService.stop();
        });

        const config: ControlPlaneApiConfig = {
          server: {
            host: "127.0.0.1",
            port: 3000,
          },
          database: {
            url: databaseStack.pooledUrl,
          },
          workflow: {
            databaseUrl: databaseStack.pooledUrl,
            namespaceId: workflowNamespaceId,
          },
          dataPlaneApi: {
            baseUrl: "http://127.0.0.1:4000",
          },
          sandbox: {
            defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
            gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
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

        const runtime = await createControlPlaneApiRuntime({
          app: config,
          internalAuthServiceToken,
          connectionToken: {
            secret: "integration-connection-secret",
            issuer: "integration-issuer",
            audience: "integration-audience",
          },
        });
        cleanupTasks.unshift(async () => {
          await runtime.stop();
        });

        await use({
          config,
          internalAuthServiceToken,
          db: runtime.db,
          mailpitService,
          databaseStack,
          request: runtime.request,
          authSession: async (input) =>
            createAuthenticatedSession({
              request: runtime.request,
              db: runtime.db,
              mailpitService,
              otpLength: config.auth.otpLength,
              ...(input?.email === undefined ? {} : { email: input.email }),
            }),
        });
      } finally {
        await runCleanupTasks({
          tasks: cleanupTasks,
          context: "control-plane-api integration fixture cleanup",
        });
      }
    },
    {
      scope: "file",
    },
  ],
});
