import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { runCleanupTasks } from "@mistle/test-harness";
import { Client, Pool } from "pg";
import { it as vitestIt } from "vitest";

const WORKER_DATABASE_NAME_PREFIX = "mistle_srpc_it_worker_";

type SharedInfraConfig = {
  databaseUsername: string;
  databasePassword: string;
  databaseDirectHost: string;
  databaseDirectPort: number;
  templateDatabaseName: string;
};

export type SandboxRuntimePlanCompilerIntegrationFixture = {
  db: ControlPlaneDatabase;
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
    databaseUsername: requireEnv("MISTLE_SRPC_IT_DB_USER"),
    databasePassword: requireEnv("MISTLE_SRPC_IT_DB_PASSWORD"),
    databaseDirectHost: requireEnv("MISTLE_SRPC_IT_DB_DIRECT_HOST"),
    databaseDirectPort: parsePort({
      value: requireEnv("MISTLE_SRPC_IT_DB_DIRECT_PORT"),
      variableName: "MISTLE_SRPC_IT_DB_DIRECT_PORT",
    }),
    templateDatabaseName: requireEnv("MISTLE_SRPC_IT_TEMPLATE_DB_NAME"),
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

export const it = vitestIt.extend<{ fixture: SandboxRuntimePlanCompilerIntegrationFixture }>({
  fixture: [
    async ({}, use) => {
      const cleanupTasks: Array<() => Promise<void>> = [];
      const sharedInfraConfig = readSharedInfraConfig();
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

        const pool = new Pool({
          connectionString: runtimeDatabaseUrl,
        });
        cleanupTasks.unshift(async () => {
          await pool.end();
        });

        const db = createControlPlaneDatabase(pool);
        await use({
          db,
        });
      } finally {
        await runCleanupTasks({
          tasks: cleanupTasks,
          context: "sandbox runtime plan compiler integration fixture cleanup",
        });
      }
    },
    {
      scope: "file",
    },
  ],
});
