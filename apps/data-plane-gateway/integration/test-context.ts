/* eslint-disable jest/expect-expect, jest/no-disabled-tests, no-empty-pattern --
 * Vitest fixture extension file intentionally uses `vitestIt.extend(...)`.
 */

import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import { readTestContext, reserveAvailablePort, runCleanupTasks } from "@mistle/test-harness";
import { Pool, Client } from "pg";
import { it as vitestIt } from "vitest";
import { z } from "zod";

import { createDataPlaneGatewayRuntime } from "../src/runtime/index.js";
import type { DataPlaneGatewayRuntimeConfig } from "../src/types.js";

const IntegrationBootstrapTokenSecret = "integration-bootstrap-token-secret";
const IntegrationTokenIssuer = "integration-data-plane-worker";
const IntegrationTokenAudience = "integration-data-plane-gateway";
const WORKER_DATABASE_NAME_PREFIX = "mistle_data_plane_gateway_it_worker_";
const TestContextId = "data-plane-gateway.integration";

const SharedInfraConfigSchema = z
  .object({
    databaseUsername: z.string().min(1),
    databasePassword: z.string().min(1),
    databaseDirectHost: z.string().min(1),
    databaseDirectPort: z.number().int().min(1).max(65_535),
    templateDatabaseName: z.string().min(1),
  })
  .strict();

type SharedInfraConfig = z.infer<typeof SharedInfraConfigSchema>;

export type DataPlaneGatewayIntegrationDatabaseStack = {
  directUrl: string;
  pooledUrl: string;
};

export type DataPlaneGatewayIntegrationFixture = {
  baseUrl: string;
  websocketBaseUrl: string;
  config: DataPlaneGatewayRuntimeConfig;
  databaseStack: DataPlaneGatewayIntegrationDatabaseStack;
  db: DataPlaneDatabase;
  dbPool: Pool;
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

export const it = vitestIt.extend<{ fixture: DataPlaneGatewayIntegrationFixture }>({
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

        const dbPool = new Pool({
          connectionString: runtimeDatabaseUrl,
        });
        cleanupTasks.unshift(async () => {
          await dbPool.end();
        });
        const db = createDataPlaneDatabase(dbPool);

        const runtimeConfig: DataPlaneGatewayRuntimeConfig = {
          app: {
            server: {
              host: "127.0.0.1",
              port: await reserveAvailablePort({ host: "127.0.0.1" }),
            },
            database: {
              url: runtimeDatabaseUrl,
            },
          },
          internalAuth: {
            serviceToken: "integration-internal-service-token",
          },
          sandbox: {
            provider: "docker",
            defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
            gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
            internalGatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
            connect: {
              tokenSecret: "integration-connect-token-secret",
              tokenIssuer: "integration-control-plane-api",
              tokenAudience: IntegrationTokenAudience,
            },
            bootstrap: {
              tokenSecret: IntegrationBootstrapTokenSecret,
              tokenIssuer: IntegrationTokenIssuer,
              tokenAudience: IntegrationTokenAudience,
            },
          },
        };

        const runtime = createDataPlaneGatewayRuntime(runtimeConfig);
        await runtime.start();
        cleanupTasks.unshift(async () => {
          await runtime.stop();
        });

        await use({
          baseUrl: `http://${runtimeConfig.app.server.host}:${String(runtimeConfig.app.server.port)}`,
          websocketBaseUrl: `ws://${runtimeConfig.app.server.host}:${String(runtimeConfig.app.server.port)}`,
          config: runtimeConfig,
          databaseStack: {
            directUrl: runtimeDatabaseUrl,
            pooledUrl: runtimeDatabaseUrl,
          },
          db,
          dbPool,
        });
      } finally {
        await runCleanupTasks({
          tasks: cleanupTasks,
          context: "data-plane-gateway integration fixture cleanup",
        });
      }
    },
    {
      scope: "file",
    },
  ],
});
