import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { runCleanupTasks } from "@mistle/test-harness";
import { readTestContext } from "@mistle/test-harness";
import { Client } from "pg";
import { it as vitestIt } from "vitest";
import { z } from "zod";

import { createControlPlaneApiRuntime } from "../src/runtime/index.js";
import type { ControlPlaneApiConfig } from "../src/types.js";
import type { AuthenticatedSession } from "./helpers/auth-session.js";
import { createAuthenticatedSession } from "./helpers/auth-session.js";

const WORKER_DATABASE_NAME_PREFIX = "mistle_control_plane_api_it_worker_";
const TestContextId = "control-plane-api.integration";

const SharedInfraConfigSchema = z
  .object({
    databaseUsername: z.string().min(1),
    databasePassword: z.string().min(1),
    databaseDirectHost: z.string().min(1),
    databaseDirectPort: z.number().int().min(1).max(65_535),
    templateDatabaseName: z.string().min(1),
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
  request: (path: string, init?: RequestInit) => Promise<Response>;
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

function createWorkerScopedDatabaseName(poolId: string): string {
  const normalizedPoolId = poolId.replace(/[^a-zA-Z0-9_]/gu, "_").toLowerCase();
  if (normalizedPoolId.length === 0) {
    throw new Error("VITEST_POOL_ID must contain at least one alphanumeric character.");
  }

  return assertSafeIdentifier(
    `${WORKER_DATABASE_NAME_PREFIX}${normalizedPoolId}`,
    "runtime database",
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

export const it = vitestIt.extend<{ fixture: ControlPlaneApiIntegrationFixture }>({
  fixture: [
    async ({}, use) => {
      const cleanupTasks: Array<() => Promise<void>> = [];
      const sharedInfraConfig = await readSharedInfraConfig();
      const workerScopedDatabaseName = createWorkerScopedDatabaseName(
        process.env.VITEST_POOL_ID ?? "0",
      );

      try {
        await resetWorkerDatabaseFromTemplate({
          username: sharedInfraConfig.databaseUsername,
          password: sharedInfraConfig.databasePassword,
          host: sharedInfraConfig.databaseDirectHost,
          port: sharedInfraConfig.databaseDirectPort,
          templateDatabaseName: sharedInfraConfig.templateDatabaseName,
          runtimeDatabaseName: workerScopedDatabaseName,
        });

        const runtimeDatabaseUrl = createDatabaseUrl({
          username: sharedInfraConfig.databaseUsername,
          password: sharedInfraConfig.databasePassword,
          host: sharedInfraConfig.databaseDirectHost,
          port: sharedInfraConfig.databaseDirectPort,
          databaseName: workerScopedDatabaseName,
        });

        const config: ControlPlaneApiConfig = {
          server: {
            host: "127.0.0.1",
            port: 3000,
          },
          database: {
            url: runtimeDatabaseUrl,
          },
          workflow: {
            databaseUrl: runtimeDatabaseUrl,
            namespaceId: sharedInfraConfig.workflowNamespaceId,
          },
          dataPlaneApi: {
            baseUrl: "http://127.0.0.1:4000",
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
            baseUrl: "http://localhost:3000",
            secret: "integration-auth-secret",
            trustedOrigins: ["http://localhost:3000"],
            otpLength: 6,
            otpExpiresInSeconds: 300,
            otpAllowedAttempts: 3,
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
          sandbox: {
            defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
            gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
          },
        });
        cleanupTasks.unshift(async () => {
          await runtime.stop();
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
