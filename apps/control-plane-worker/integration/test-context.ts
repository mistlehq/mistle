import { readTestContext } from "@mistle/test-harness";
import { Client } from "pg";
import { it as vitestIt } from "vitest";
import { z } from "zod";

import type { ControlPlaneWorkerConfig } from "../src/types.js";

const WORKER_DATABASE_NAME_PREFIX = "mistle_control_plane_worker_it_worker_";
const TestContextId = "control-plane-worker.integration";

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

export type ControlPlaneWorkerIntegrationDatabaseStack = {
  directUrl: string;
  pooledUrl: string;
};

export type ControlPlaneWorkerIntegrationFixture = {
  config: ControlPlaneWorkerConfig;
  internalAuthServiceToken: string;
  databaseStack: ControlPlaneWorkerIntegrationDatabaseStack;
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

export const it = vitestIt.extend<{ fixture: ControlPlaneWorkerIntegrationFixture }>({
  fixture: [
    async ({}, use) => {
      const sharedInfraConfig = await readSharedInfraConfig();
      const workerScopedDatabaseName = createWorkerScopedDatabaseName(
        process.env.VITEST_POOL_ID ?? "0",
      );

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

      const config: ControlPlaneWorkerConfig = {
        server: {
          host: "127.0.0.1",
          port: 3001,
        },
        workflow: {
          databaseUrl: runtimeDatabaseUrl,
          namespaceId: sharedInfraConfig.workflowNamespaceId,
          runMigrations: false,
          concurrency: 1,
        },
        email: {
          fromAddress: "no-reply@mistle.dev",
          fromName: "Mistle",
          smtpHost: "127.0.0.1",
          smtpPort: 1025,
          smtpSecure: false,
          smtpUsername: "mailpit",
          smtpPassword: "mailpit",
        },
        dataPlaneApi: {
          baseUrl: "http://127.0.0.1:5300",
        },
        controlPlaneApi: {
          baseUrl: "http://127.0.0.1:5000",
        },
      };

      await use({
        config,
        internalAuthServiceToken: sharedInfraConfig.internalAuthServiceToken,
        databaseStack: {
          directUrl: runtimeDatabaseUrl,
          pooledUrl: runtimeDatabaseUrl,
        },
      });
    },
    {
      scope: "file",
    },
  ],
});
