/* eslint-disable jest/expect-expect, jest/no-disabled-tests, no-empty-pattern --
 * Vitest fixture extension file intentionally uses `vitestIt.extend(...)`.
 */

import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import {
  createIntegrationRuntimeScopeId,
  createIntegrationRuntimeDatabaseName,
  getCurrentVitestFilePath,
  readTestContext,
  reserveAvailablePort,
  runCleanupTasks,
} from "@mistle/test-harness";
import { Pool, Client } from "pg";
import { it as vitestIt } from "vitest";
import { z } from "zod";

import { createDataPlaneGatewayRuntime } from "../src/runtime/index.js";
import type { DataPlaneGatewayRuntimeConfig } from "../src/types.js";

const IntegrationBootstrapTokenSecret = "integration-bootstrap-token-secret";
const IntegrationTokenIssuer = "integration-data-plane-worker";
const IntegrationTokenAudience = "integration-data-plane-gateway";
const RUNTIME_DATABASE_NAME_PREFIX = "mistle_data_plane_gateway_it_runtime";
const TestContextId = "data-plane-gateway.integration";

const SharedInfraConfigSchema = z
  .object({
    databaseUsername: z.string().min(1),
    databasePassword: z.string().min(1),
    databaseDirectHost: z.string().min(1),
    databaseDirectPort: z.number().int().min(1).max(65_535),
    valkeyUrl: z.string().min(1),
    templateDatabaseName: z.string().min(1),
    integrationRunId: z.string().min(1),
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

type RuntimeStateBackend = DataPlaneGatewayRuntimeConfig["app"]["runtimeState"]["backend"];

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
    await adminClient.query(`DROP DATABASE IF EXISTS ${quotedRuntimeDatabaseName} WITH (FORCE)`);
  } finally {
    await adminClient.end();
  }
}

function createRuntimeStateConfig(input: {
  backend: RuntimeStateBackend;
  runtimeDatabaseName: string;
  valkeyUrl: string;
}): DataPlaneGatewayRuntimeConfig["app"]["runtimeState"] {
  if (input.backend === "memory") {
    return {
      backend: "memory",
    };
  }

  return {
    backend: "valkey",
    valkey: {
      url: input.valkeyUrl,
      keyPrefix: `mistle:runtime-state:gateway-integration:${input.runtimeDatabaseName}`,
    },
  };
}

function createIntegrationIt(backend: RuntimeStateBackend) {
  return vitestIt.extend<{ fixture: DataPlaneGatewayIntegrationFixture }>({
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
              runtimeState: createRuntimeStateConfig({
                backend,
                runtimeDatabaseName,
                valkeyUrl: sharedInfraConfig.valkeyUrl,
              }),
              dataPlaneApi: {
                baseUrl: "http://127.0.0.1:5300",
              },
            },
            internalAuth: {
              serviceToken: "integration-service-token",
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
              egress: {
                tokenSecret: "integration-egress-token-secret",
                tokenIssuer: "integration-data-plane-worker",
                tokenAudience: "integration-tokenizer-proxy",
              },
            },
          };

          const runtime = createDataPlaneGatewayRuntime(runtimeConfig);
          await runtime.start();
          cleanupTasks.unshift(async () => {
            await runtime.stop();
          });
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
}

export const it = createIntegrationIt("valkey");
export const itMemory = createIntegrationIt("memory");
