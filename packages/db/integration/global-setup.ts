import {
  acquireSharedPostgresInfra,
  DEFAULT_SHARED_INTEGRATION_INFRA_KEY,
  removeTestContext,
  writeTestContext,
} from "@mistle/test-harness";
import { Client as PgClient } from "pg";

const SHARED_INFRA_KEY = DEFAULT_SHARED_INTEGRATION_INFRA_KEY;
const TEMPLATE_DATABASE_NAME = "mistle_db_it_template";
const TestContextId = "db.integration";

function assertSafeIdentifier(identifier: string, label: string): string {
  if (!/^[a-z0-9_]+$/u.test(identifier)) {
    throw new Error(`${label} must contain only lowercase alphanumeric and underscore characters.`);
  }

  return identifier;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier}"`;
}

async function resetTemplateDatabase(input: {
  username: string;
  password: string;
  host: string;
  port: number;
  databaseName: string;
}): Promise<void> {
  const adminClient = new PgClient({
    host: input.host,
    port: input.port,
    user: input.username,
    password: input.password,
    database: "postgres",
  });
  const safeDatabaseName = assertSafeIdentifier(input.databaseName, "template database name");
  const quotedDatabaseName = quoteIdentifier(safeDatabaseName);

  await adminClient.connect();
  try {
    await adminClient.query(`DROP DATABASE IF EXISTS ${quotedDatabaseName} WITH (FORCE)`);
    await adminClient.query(`CREATE DATABASE ${quotedDatabaseName}`);
  } finally {
    await adminClient.end();
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  const sharedInfraLease = await acquireSharedPostgresInfra({
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
