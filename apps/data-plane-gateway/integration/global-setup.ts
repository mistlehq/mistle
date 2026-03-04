import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import {
  acquireSharedPostgresInfra,
  DEFAULT_SHARED_INTEGRATION_INFRA_KEY,
} from "@mistle/test-harness";
import { Client as PgClient } from "pg";

const SHARED_INFRA_KEY = DEFAULT_SHARED_INTEGRATION_INFRA_KEY;
const TEMPLATE_DATABASE_NAME = "mistle_data_plane_gateway_it_template";

function setEnv(name: string, value: string): void {
  process.env[name] = value;
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
    const postgresService = sharedInfraLease.infra.postgres;

    await resetTemplateDatabase({
      username: postgresService.postgres.username,
      password: postgresService.postgres.password,
      host: postgresService.postgres.host,
      port: postgresService.postgres.port,
      databaseName: TEMPLATE_DATABASE_NAME,
    });

    const templateDirectUrl = createDatabaseUrl({
      username: postgresService.postgres.username,
      password: postgresService.postgres.password,
      host: postgresService.postgres.host,
      port: postgresService.postgres.port,
      databaseName: TEMPLATE_DATABASE_NAME,
    });

    await runDataPlaneMigrations({
      connectionString: templateDirectUrl,
      schemaName: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
      migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
      migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
    });

    setEnv("MISTLE_DP_GATEWAY_IT_DB_USER", postgresService.postgres.username);
    setEnv("MISTLE_DP_GATEWAY_IT_DB_PASSWORD", postgresService.postgres.password);
    setEnv("MISTLE_DP_GATEWAY_IT_DB_DIRECT_HOST", postgresService.postgres.host);
    setEnv("MISTLE_DP_GATEWAY_IT_DB_DIRECT_PORT", String(postgresService.postgres.port));
    setEnv("MISTLE_DP_GATEWAY_IT_TEMPLATE_DB_NAME", TEMPLATE_DATABASE_NAME);
  } catch (error) {
    await sharedInfraLease.release();
    throw error;
  }

  return async () => {
    await sharedInfraLease.release();
  };
}
