import {
  acquireSharedPostgresMailpitInfra,
  DEFAULT_SHARED_INTEGRATION_INFRA_KEY,
  removeTestContext,
  writeTestContext,
} from "@mistle/test-harness";
import postgres from "postgres";

const SHARED_INFRA_KEY = DEFAULT_SHARED_INTEGRATION_INFRA_KEY;
const TEMPLATE_DATABASE_NAME = "mistle_workflows_it_template";
const TestContextId = "workflows.integration";

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

async function resetTemplateDatabase(input: {
  username: string;
  password: string;
  host: string;
  port: number;
  databaseName: string;
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
  const safeDatabaseName = assertSafeIdentifier(input.databaseName, "template database name");
  const quotedDatabaseName = quoteIdentifier(safeDatabaseName);

  try {
    await adminSql.unsafe(`DROP DATABASE IF EXISTS ${quotedDatabaseName} WITH (FORCE)`);
    await adminSql.unsafe(`CREATE DATABASE ${quotedDatabaseName}`);
  } finally {
    await adminSql.end({ timeout: 5 });
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  const sharedInfraLease = await acquireSharedPostgresMailpitInfra({
    key: SHARED_INFRA_KEY,
    postgres: {},
  });

  try {
    await resetTemplateDatabase({
      username: sharedInfraLease.infra.postgres.postgres.username,
      password: sharedInfraLease.infra.postgres.postgres.password,
      host: sharedInfraLease.infra.postgres.postgres.host,
      port: sharedInfraLease.infra.postgres.postgres.port,
      databaseName: TEMPLATE_DATABASE_NAME,
    });

    await writeTestContext({
      id: TestContextId,
      value: {
        databaseUsername: sharedInfraLease.infra.postgres.postgres.username,
        databasePassword: sharedInfraLease.infra.postgres.postgres.password,
        databaseDirectHost: sharedInfraLease.infra.postgres.postgres.host,
        databaseDirectPort: sharedInfraLease.infra.postgres.postgres.port,
        templateDatabaseName: TEMPLATE_DATABASE_NAME,
        mailpitSmtpHost: sharedInfraLease.infra.mailpit.smtpHost,
        mailpitSmtpPort: sharedInfraLease.infra.mailpit.smtpPort,
        mailpitHttpBaseUrl: sharedInfraLease.infra.mailpit.httpBaseUrl,
      },
    });
  } catch (error) {
    await removeTestContext(TestContextId);
    await sharedInfraLease.release();
    throw error;
  }

  return async () => {
    await removeTestContext(TestContextId);
    await sharedInfraLease.release();
  };
}
