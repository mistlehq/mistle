import postgres from "postgres";
import { it as vitestIt } from "vitest";

const WORKER_DATABASE_NAME_PREFIX = "mistle_workflows_it_worker_";
const TEMPLATE_DATABASE_CLONE_LOCK_ID = 97_761_443;

export type WorkflowsIntegrationDatabaseStack = {
  directUrl: string;
  pooledUrl: string;
};

type SharedInfraConfig = {
  databaseUsername: string;
  databasePassword: string;
  databaseDirectHost: string;
  databaseDirectPort: number;
  templateDatabaseName: string;
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
    databaseUsername: requireEnv("MISTLE_WF_IT_DB_USER"),
    databasePassword: requireEnv("MISTLE_WF_IT_DB_PASSWORD"),
    databaseDirectHost: requireEnv("MISTLE_WF_IT_DB_DIRECT_HOST"),
    databaseDirectPort: parsePort({
      value: requireEnv("MISTLE_WF_IT_DB_DIRECT_PORT"),
      variableName: "MISTLE_WF_IT_DB_DIRECT_PORT",
    }),
    templateDatabaseName: requireEnv("MISTLE_WF_IT_TEMPLATE_DB_NAME"),
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
  const adminSql = postgres(
    createDatabaseUrl({
      username: input.username,
      password: input.password,
      host: input.host,
      port: input.port,
      databaseName: "postgres",
    }),
    {
      max: 1,
    },
  );
  const quotedTemplateDatabaseName = quoteIdentifier(
    assertSafeIdentifier(input.templateDatabaseName, "template database"),
  );
  const quotedRuntimeDatabaseName = quoteIdentifier(
    assertSafeIdentifier(input.runtimeDatabaseName, "runtime database"),
  );

  try {
    await adminSql`select pg_advisory_lock(${TEMPLATE_DATABASE_CLONE_LOCK_ID})`;
    try {
      await adminSql.unsafe(`ALTER DATABASE ${quotedTemplateDatabaseName} ALLOW_CONNECTIONS false`);
      try {
        await adminSql`
          select pg_terminate_backend(pid)
          from pg_stat_activity
          where datname = ${input.templateDatabaseName} and pid <> pg_backend_pid()
        `;

        await adminSql.unsafe(`DROP DATABASE IF EXISTS ${quotedRuntimeDatabaseName} WITH (FORCE)`);
        await adminSql.unsafe(
          `CREATE DATABASE ${quotedRuntimeDatabaseName} TEMPLATE ${quotedTemplateDatabaseName}`,
        );
      } finally {
        await adminSql.unsafe(
          `ALTER DATABASE ${quotedTemplateDatabaseName} ALLOW_CONNECTIONS true`,
        );
      }
    } finally {
      await adminSql`select pg_advisory_unlock(${TEMPLATE_DATABASE_CLONE_LOCK_ID})`;
    }
  } finally {
    await adminSql.end({ timeout: 5 });
  }
}

export const it = vitestIt.extend<{ databaseStack: WorkflowsIntegrationDatabaseStack }>({
  databaseStack: [
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

      await use({
        directUrl: runtimeDatabaseUrl,
        pooledUrl: runtimeDatabaseUrl,
      });
    },
    {
      scope: "file",
    },
  ],
});
