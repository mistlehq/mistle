import { getLocalDevDockerRegistrySandboxBaseImageRef } from "@mistle/config";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  createIntegrationRuntimeScopeId,
  createIntegrationRuntimeDatabaseName,
  getCurrentVitestFilePath,
  readTestContext,
  reserveAvailablePort,
  runCleanupTasks,
} from "@mistle/test-harness";
import { systemSleeper } from "@mistle/time";
import { Client } from "pg";
import { it as vitestIt } from "vitest";
import { z } from "zod";

import { createControlPlaneApiRuntime } from "../src/main.js";
import type { ControlPlaneApiConfig } from "../src/types.js";
import type { AuthenticatedSession } from "./helpers/auth-session.js";
import { createAuthenticatedSession } from "./helpers/auth-session.js";
import { ensureCommitSignBinary } from "./helpers/commit-sign.js";

const RUNTIME_DATABASE_NAME_PREFIX = "mistle_control_plane_api_it_runtime";
const TestContextId = "control-plane-api.integration";
const DatabaseDrainTimeoutMs = 5_000;
const DatabaseDrainPollIntervalMs = 50;

const SharedInfraConfigSchema = z
  .object({
    databaseUsername: z.string().min(1),
    databasePassword: z.string().min(1),
    databaseDirectHost: z.string().min(1),
    databaseDirectPort: z.number().int().min(1).max(65_535),
    templateDatabaseName: z.string().min(1),
    integrationRunId: z.string().min(1),
    workflowNamespaceId: z.string().min(1),
    internalAuthServiceToken: z.string().min(1),
  })
  .strict();

type SharedInfraConfig = z.infer<typeof SharedInfraConfigSchema>;

export type ControlPlaneApiIntegrationDatabaseStack = {
  directUrl: string;
  pooledUrl: string;
};

export type ControlPlaneApiIntegrationFixture = {
  config: ControlPlaneApiConfig;
  internalAuthServiceToken: string;
  db: ControlPlaneDatabase;
  databaseStack: ControlPlaneApiIntegrationDatabaseStack;
  request: (path: string, init?: RequestInit) => Response | Promise<Response>;
  authSession: (input?: { email?: string }) => Promise<AuthenticatedSession>;
};

async function readSharedInfraConfig(): Promise<SharedInfraConfig> {
  return readTestContext({
    id: TestContextId,
    schema: SharedInfraConfigSchema,
  });
}

function assertSafeIdentifier(identifier: string, label: string): string {
  if (!/^[a-z0-9_]+$/u.test(identifier)) {
    throw new Error(`${label} must contain only lowercase alphanumeric and underscore characters.`);
  }

  return identifier;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier}"`;
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

function createFileScopedDatabaseName(input: {
  integrationRunId: string;
  filePath: string;
  scopeId: string;
}): string {
  return createIntegrationRuntimeDatabaseName({
    prefix: RUNTIME_DATABASE_NAME_PREFIX,
    runId: input.integrationRunId,
    filePath: input.filePath,
    scopeId: input.scopeId,
  });
}

async function waitForDatabaseDisconnections(input: {
  adminClient: Client;
  databaseName: string;
}): Promise<void> {
  const deadline = Date.now() + DatabaseDrainTimeoutMs;

  while (Date.now() < deadline) {
    const result = await input.adminClient.query<{ connection_count: string }>(
      `
        select count(*)::text as connection_count
        from pg_stat_activity
        where datname = $1
          and pid <> pg_backend_pid()
      `,
      [input.databaseName],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("Expected database connection count query to return a row.");
    }

    if (Number(row.connection_count) === 0) {
      return;
    }

    await systemSleeper.sleep(DatabaseDrainPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for runtime database '${input.databaseName}' connections to drain before cleanup.`,
  );
}

async function resetWorkerDatabaseFromTemplate(input: {
  username: string;
  password: string;
  host: string;
  port: number;
  templateDatabaseName: string;
  runtimeDatabaseName: string;
}): Promise<void> {
  const adminClient = new Client({
    connectionString: createDatabaseUrl({
      username: input.username,
      password: input.password,
      host: input.host,
      port: input.port,
      databaseName: "postgres",
    }),
  });

  const quotedTemplateDatabaseName = quoteIdentifier(
    assertSafeIdentifier(input.templateDatabaseName, "template database"),
  );
  const quotedRuntimeDatabaseName = quoteIdentifier(
    assertSafeIdentifier(input.runtimeDatabaseName, "runtime database"),
  );

  await adminClient.connect();
  try {
    await adminClient.query(`DROP DATABASE IF EXISTS ${quotedRuntimeDatabaseName} WITH (FORCE)`);
    await adminClient.query(
      `CREATE DATABASE ${quotedRuntimeDatabaseName} TEMPLATE ${quotedTemplateDatabaseName}`,
    );
  } finally {
    await adminClient.end();
  }
}

async function dropDatabaseIfExists(input: {
  username: string;
  password: string;
  host: string;
  port: number;
  databaseName: string;
}): Promise<void> {
  const adminClient = new Client({
    connectionString: createDatabaseUrl({
      username: input.username,
      password: input.password,
      host: input.host,
      port: input.port,
      databaseName: "postgres",
    }),
  });

  const quotedRuntimeDatabaseName = quoteIdentifier(
    assertSafeIdentifier(input.databaseName, "runtime database"),
  );

  await adminClient.connect();
  try {
    await adminClient.query(
      `ALTER DATABASE ${quotedRuntimeDatabaseName} WITH ALLOW_CONNECTIONS false`,
    );
    await waitForDatabaseDisconnections({
      adminClient,
      databaseName: input.databaseName,
    });
    await adminClient.query(`DROP DATABASE IF EXISTS ${quotedRuntimeDatabaseName}`);
  } finally {
    await adminClient.end();
  }
}

export const it = vitestIt.extend<{
  fixture: ControlPlaneApiIntegrationFixture;
}>({
  fixture: [
    async ({}, use) => {
      const cleanupTasks: Array<() => Promise<void>> = [];
      const sharedInfraConfig = await readSharedInfraConfig();
      const runtimeDatabaseName = createFileScopedDatabaseName({
        integrationRunId: sharedInfraConfig.integrationRunId,
        filePath: getCurrentVitestFilePath(),
        scopeId: createIntegrationRuntimeScopeId(),
      });

      try {
        const commitSignBinaryPath = await ensureCommitSignBinary();
        await resetWorkerDatabaseFromTemplate({
          username: sharedInfraConfig.databaseUsername,
          password: sharedInfraConfig.databasePassword,
          host: sharedInfraConfig.databaseDirectHost,
          port: sharedInfraConfig.databaseDirectPort,
          templateDatabaseName: sharedInfraConfig.templateDatabaseName,
          runtimeDatabaseName,
        });

        const runtimeDatabaseUrl = createDatabaseUrl({
          username: sharedInfraConfig.databaseUsername,
          password: sharedInfraConfig.databasePassword,
          host: sharedInfraConfig.databaseDirectHost,
          port: sharedInfraConfig.databaseDirectPort,
          databaseName: runtimeDatabaseName,
        });
        const controlPlaneHost = "127.0.0.1";
        const controlPlanePort = await reserveAvailablePort({ host: controlPlaneHost });
        const controlPlaneBaseUrl = `http://${controlPlaneHost}:${String(controlPlanePort)}`;
        const dataPlaneHost = "127.0.0.1";
        const dataPlanePort = await reserveAvailablePort({ host: dataPlaneHost });

        const config: ControlPlaneApiConfig = {
          server: {
            host: controlPlaneHost,
            port: controlPlanePort,
          },
          database: {
            url: runtimeDatabaseUrl,
            migrationUrl: runtimeDatabaseUrl,
          },
          objectStore: {
            bucketName: "integration-media",
            region: "us-east-1",
            endpoint: "http://127.0.0.1:8333",
            forcePathStyle: true,
            accessKeyId: "integration-access-key",
            secretAccessKey: "integration-secret-key",
          },
          workflow: {
            databaseUrl: runtimeDatabaseUrl,
            migrationUrl: runtimeDatabaseUrl,
            namespaceId: sharedInfraConfig.workflowNamespaceId,
          },
          dataPlaneApi: {
            baseUrl: `http://${dataPlaneHost}:${String(dataPlanePort)}`,
          },
          integrations: {
            activeMasterEncryptionKeyVersion: 1,
            masterEncryptionKeys: {
              "1": "integration-master-key-testing",
            },
          },
          dashboard: {
            baseUrl: "http://localhost:5173",
          },
          auth: {
            baseUrl: controlPlaneBaseUrl,
            secret: "integration-auth-secret",
            trustedOrigins: [controlPlaneBaseUrl],
            otpLength: 6,
            otpExpiresInSeconds: 300,
            otpAllowedAttempts: 3,
          },
          commitSign: {
            binaryPath: commitSignBinaryPath,
          },
        };

        const runtime = await createControlPlaneApiRuntime({
          app: config,
          internalAuthServiceToken: sharedInfraConfig.internalAuthServiceToken,
          connectionToken: {
            secret: "integration-connection-secret",
            issuer: "integration-issuer",
            audience: "integration-audience",
          },
          portAccess: {
            baseDomain: "mistle.localhost",
            gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
            access: {
              tokenSecret: "integration-port-access-secret",
              tokenIssuer: "integration-control-plane-api",
              tokenAudience: "integration-data-plane-gateway",
            },
          },
          sandbox: {
            defaultBaseImage: getLocalDevDockerRegistrySandboxBaseImageRef(),
            gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
            bootstrap: {
              tokenSecret: "integration-bootstrap-token-secret",
              tokenIssuer: "integration-data-plane-worker",
              tokenAudience: "integration-data-plane-gateway",
            },
          },
        });
        cleanupTasks.unshift(async () => {
          await runtime.stop();
        });
        await runtime.start();
        cleanupTasks.push(async () => {
          await dropDatabaseIfExists({
            username: sharedInfraConfig.databaseUsername,
            password: sharedInfraConfig.databasePassword,
            host: sharedInfraConfig.databaseDirectHost,
            port: sharedInfraConfig.databaseDirectPort,
            databaseName: runtimeDatabaseName,
          });
        });

        await use({
          config,
          internalAuthServiceToken: sharedInfraConfig.internalAuthServiceToken,
          db: runtime.db,
          databaseStack: {
            directUrl: runtimeDatabaseUrl,
            pooledUrl: runtimeDatabaseUrl,
          },
          request: runtime.request,
          authSession: async (input) =>
            createAuthenticatedSession({
              request: runtime.request,
              db: runtime.db,
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
