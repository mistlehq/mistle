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

import { createDataPlaneApiRuntime } from "../src/runtime/index.js";
import type { DataPlaneApiConfig } from "../src/types.js";

const RUNTIME_DATABASE_NAME_PREFIX = "mistle_data_plane_api_it_runtime";
const TestContextId = "data-plane-api.integration";

export type DataPlaneApiIntegrationDatabaseStack = {
  directUrl: string;
  pooledUrl: string;
};

export type DataPlaneApiIntegrationFixture = {
  baseUrl: string;
  config: DataPlaneApiConfig;
  internalAuthServiceToken: string;
  databaseStack: DataPlaneApiIntegrationDatabaseStack;
  db: DataPlaneDatabase;
  dbPool: Pool;
};

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

export const it = vitestIt.extend<{ fixture: DataPlaneApiIntegrationFixture }>({
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

        const config: DataPlaneApiConfig = {
          server: {
            host: "127.0.0.1",
            port: await reserveAvailablePort({ host: "127.0.0.1" }),
          },
          database: {
            url: runtimeDatabaseUrl,
            migrationUrl: runtimeDatabaseUrl,
          },
          workflow: {
            databaseUrl: runtimeDatabaseUrl,
            namespaceId: sharedInfraConfig.workflowNamespaceId,
          },
          runtimeState: {
            gatewayBaseUrl: `http://127.0.0.1:${String(
              await reserveAvailablePort({ host: "127.0.0.1" }),
            )}`,
          },
        };

        const runtime = await createDataPlaneApiRuntime({
          app: config,
          internalAuthServiceToken: sharedInfraConfig.internalAuthServiceToken,
          sandboxProvider: "docker",
        });
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
          baseUrl: `http://${config.server.host}:${String(config.server.port)}`,
          config,
          internalAuthServiceToken: sharedInfraConfig.internalAuthServiceToken,
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
          context: "data-plane-api integration fixture cleanup",
        });
      }
    },
    {
      scope: "file",
    },
  ],
});
