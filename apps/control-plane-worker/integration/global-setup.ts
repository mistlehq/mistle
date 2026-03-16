import {
  acquireSharedPostgresInfra,
  createIntegrationTemplateDatabaseName,
  DEFAULT_SHARED_INTEGRATION_INFRA_KEY,
  removeTestContext,
  resolveIntegrationRunId,
  writeTestContext,
} from "@mistle/test-harness";
import { Client as PgClient } from "pg";

import { createControlPlaneBackend } from "../openworkflow/core/client.js";

const SHARED_INFRA_KEY = DEFAULT_SHARED_INTEGRATION_INFRA_KEY;
const TEMPLATE_DATABASE_NAME_PREFIX = "mistle_control_plane_worker_it_template";
const WORKFLOW_NAMESPACE_ID = "integration";
const INTERNAL_AUTH_SERVICE_TOKEN = "integration-service-token";
const TestContextId = "control-plane-worker.integration";

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

async function dropDatabaseIfExists(input: {
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
  } finally {
    await adminClient.end();
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  const integrationRunId = resolveIntegrationRunId();
  const sharedInfraLease = await acquireSharedPostgresInfra({
    key: SHARED_INFRA_KEY,
    postgres: {},
  });
  const templateDatabaseName = createIntegrationTemplateDatabaseName({
    prefix: TEMPLATE_DATABASE_NAME_PREFIX,
    runId: integrationRunId,
  });

  try {
    const postgresService = sharedInfraLease.infra.postgres;

    await resetTemplateDatabase({
      username: postgresService.postgres.username,
      password: postgresService.postgres.password,
      host: postgresService.postgres.host,
      port: postgresService.postgres.port,
      databaseName: templateDatabaseName,
    });

    const templateDirectUrl = createDatabaseUrl({
      username: postgresService.postgres.username,
      password: postgresService.postgres.password,
      host: postgresService.postgres.host,
      port: postgresService.postgres.port,
      databaseName: templateDatabaseName,
    });

    const workflowBackend = await createControlPlaneBackend({
      url: templateDirectUrl,
      namespaceId: WORKFLOW_NAMESPACE_ID,
      runMigrations: true,
    });
    await workflowBackend.stop();

    await writeTestContext({
      id: TestContextId,
      value: {
        databaseUsername: postgresService.postgres.username,
        databasePassword: postgresService.postgres.password,
        databaseDirectHost: postgresService.postgres.host,
        databaseDirectPort: postgresService.postgres.port,
        templateDatabaseName: templateDatabaseName,
        integrationRunId,
        workflowNamespaceId: WORKFLOW_NAMESPACE_ID,
        internalAuthServiceToken: INTERNAL_AUTH_SERVICE_TOKEN,
      },
    });
  } catch (error) {
    await removeTestContext(TestContextId);
    await dropDatabaseIfExists({
      username: sharedInfraLease.infra.postgres.postgres.username,
      password: sharedInfraLease.infra.postgres.postgres.password,
      host: sharedInfraLease.infra.postgres.postgres.host,
      port: sharedInfraLease.infra.postgres.postgres.port,
      databaseName: templateDatabaseName,
    });
    await sharedInfraLease.release();
    throw error;
  }

  return async () => {
    await removeTestContext(TestContextId);
    await dropDatabaseIfExists({
      username: sharedInfraLease.infra.postgres.postgres.username,
      password: sharedInfraLease.infra.postgres.postgres.password,
      host: sharedInfraLease.infra.postgres.postgres.host,
      port: sharedInfraLease.infra.postgres.postgres.port,
      databaseName: templateDatabaseName,
    });
    await sharedInfraLease.release();
  };
}
