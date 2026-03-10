import { readTestContext } from "@mistle/test-harness";
import postgres from "postgres";
import { it as vitestIt } from "vitest";
import { z } from "zod";

const WORKER_DATABASE_NAME_PREFIX = "mistle_workflows_it_worker_";
const TEMPLATE_DATABASE_CLONE_LOCK_ID = 97_761_443;
const TestContextId = "workflows.integration";

export type WorkflowsIntegrationDatabaseStack = {
  directUrl: string;
  pooledUrl: string;
};

const SharedInfraConfigSchema = z
  .object({
    databaseUsername: z.string().min(1),
    databasePassword: z.string().min(1),
    databaseDirectHost: z.string().min(1),
    databaseDirectPort: z.number().int().min(1).max(65_535),
    templateDatabaseName: z.string().min(1),
    mailpitSmtpHost: z.string().min(1),
    mailpitSmtpPort: z.number().int().min(1).max(65_535),
    mailpitHttpBaseUrl: z.url(),
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
