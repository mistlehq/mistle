import { Client } from "pg";
import { it as vitestIt } from "vitest";

import type { ControlPlaneWorkerConfig } from "../src/types.js";

const WORKER_DATABASE_NAME_PREFIX = "mistle_control_plane_worker_it_worker_";

type SharedInfraConfig = {
  databaseUsername: string;
  databasePassword: string;
  databaseDirectHost: string;
  databaseDirectPort: number;
  templateDatabaseName: string;
  workflowNamespaceId: string;
  internalAuthServiceToken: string;
};

export type ControlPlaneWorkerIntegrationDatabaseStack = {
  directUrl: string;
  pooledUrl: string;
};

export type ControlPlaneWorkerIntegrationFixture = {
  config: ControlPlaneWorkerConfig;
  internalAuthServiceToken: string;
  databaseStack: ControlPlaneWorkerIntegrationDatabaseStack;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required integration environment variable: ${name}`);
  }

  return value;
}

function parsePort(input: { value: string; variableName: string }): number {
  const parsedPort = Number.parseInt(input.value, 10);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error(`Environment variable ${input.variableName} must be a valid TCP port.`);
  }

  return parsedPort;
}

function readSharedInfraConfig(): SharedInfraConfig {
  return {
    databaseUsername: requireEnv("MISTLE_CP_WORKER_IT_DB_USER"),
    databasePassword: requireEnv("MISTLE_CP_WORKER_IT_DB_PASSWORD"),
    databaseDirectHost: requireEnv("MISTLE_CP_WORKER_IT_DB_DIRECT_HOST"),
    databaseDirectPort: parsePort({
      value: requireEnv("MISTLE_CP_WORKER_IT_DB_DIRECT_PORT"),
      variableName: "MISTLE_CP_WORKER_IT_DB_DIRECT_PORT",
    }),
    templateDatabaseName: requireEnv("MISTLE_CP_WORKER_IT_TEMPLATE_DB_NAME"),
    workflowNamespaceId: requireEnv("MISTLE_CP_WORKER_IT_WORKFLOW_NAMESPACE_ID"),
    internalAuthServiceToken: requireEnv("MISTLE_CP_WORKER_IT_INTERNAL_AUTH_SERVICE_TOKEN"),
  };
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
      const sharedInfraConfig = readSharedInfraConfig();
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
