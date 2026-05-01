import { createHash } from "node:crypto";

import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";
import { S3CompatibleObjectStore } from "@mistle/object-store";
import { Pool } from "pg";

import { createControlPlaneBackend, createControlPlaneOpenWorkflow } from "./openworkflow.js";
import type { ControlPlaneApiConfig } from "./types.js";

export type AppRuntimeResources = {
  db: ControlPlaneDatabase;
  dbPool: Pool;
  objectStore: S3CompatibleObjectStore;
  integrationRegistry: IntegrationRegistry;
  workflowBackend: Awaited<ReturnType<typeof createControlPlaneBackend>>;
  openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
  testWorkflowsByEnvironmentId: ReadonlyMap<
    string,
    Promise<{
      backend: Awaited<ReturnType<typeof createControlPlaneBackend>>;
      openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
    }>
  >;
  getDb: (input?: { testEnvironmentId?: string }) => ControlPlaneDatabase;
  getOpenWorkflow: (input?: {
    testEnvironmentId?: string;
  }) => Promise<ReturnType<typeof createControlPlaneOpenWorkflow>>;
};

export async function createAppResources(
  config: ControlPlaneApiConfig,
): Promise<AppRuntimeResources> {
  const dbPool = new Pool({
    connectionString: config.database.url,
  });
  const db = createControlPlaneDatabase(dbPool);
  const testDbsByEnvironmentId = new Map<string, ControlPlaneDatabase>();
  const testWorkflowsByEnvironmentId = new Map<
    string,
    Promise<{
      backend: Awaited<ReturnType<typeof createControlPlaneBackend>>;
      openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
    }>
  >();
  const objectStore = new S3CompatibleObjectStore({
    bucketName: config.objectStore.bucketName,
    region: config.objectStore.region,
    ...(config.objectStore.endpoint === undefined
      ? {}
      : {
          endpoint: config.objectStore.endpoint,
        }),
    ...(config.objectStore.forcePathStyle === undefined
      ? {}
      : {
          forcePathStyle: config.objectStore.forcePathStyle,
        }),
    credentials: {
      accessKeyId: config.objectStore.accessKeyId,
      secretAccessKey: config.objectStore.secretAccessKey,
    },
  });
  const integrationRegistry = createIntegrationRegistry();
  let workflowBackend: Awaited<ReturnType<typeof createControlPlaneBackend>>;

  try {
    workflowBackend = await createControlPlaneBackend({
      url: config.workflow.databaseUrl,
      namespaceId: config.workflow.namespaceId,
      runMigrations: false,
    });
  } catch (error) {
    objectStore.destroy();
    await dbPool.end();
    throw error;
  }

  const openWorkflow = createControlPlaneOpenWorkflow({ backend: workflowBackend });

  return {
    db,
    dbPool,
    objectStore,
    integrationRegistry,
    workflowBackend,
    openWorkflow,
    testWorkflowsByEnvironmentId,
    getDb: (request = {}) => {
      const testIsolation = config.__dangerouslyEnableTestIsolation;
      if (testIsolation === undefined) {
        return db;
      }

      const testEnvironmentId = request.testEnvironmentId;
      if (testEnvironmentId === undefined || testEnvironmentId.length === 0) {
        throw new Error("Expected test environment id for isolated control-plane API request.");
      }

      const existingDb = testDbsByEnvironmentId.get(testEnvironmentId);
      if (existingDb !== undefined) {
        return existingDb;
      }

      const testDb = createControlPlaneDatabase(dbPool, {
        schemaName: createControlPlaneTestSchemaName(testEnvironmentId),
      });
      testDbsByEnvironmentId.set(testEnvironmentId, testDb);
      return testDb;
    },
    getOpenWorkflow: async (request = {}) => {
      const testIsolation = config.__dangerouslyEnableTestIsolation;
      if (testIsolation === undefined) {
        return openWorkflow;
      }

      const testEnvironmentId = request.testEnvironmentId;
      if (testEnvironmentId === undefined || testEnvironmentId.length === 0) {
        throw new Error(
          "Expected test environment id for isolated control-plane workflow request.",
        );
      }

      const existingWorkflow = testWorkflowsByEnvironmentId.get(testEnvironmentId);
      if (existingWorkflow !== undefined) {
        return (await existingWorkflow).openWorkflow;
      }

      const workflowPromise = createTestControlPlaneWorkflow({
        config,
        testEnvironmentId,
      });
      testWorkflowsByEnvironmentId.set(testEnvironmentId, workflowPromise);
      return (await workflowPromise).openWorkflow;
    },
  };
}

export async function stopAppResources(resources: AppRuntimeResources): Promise<void> {
  resources.objectStore.destroy();
  const testWorkflows = await Promise.all(resources.testWorkflowsByEnvironmentId.values());
  await Promise.all([
    resources.dbPool.end(),
    resources.workflowBackend.stop(),
    ...testWorkflows.map((workflow) => workflow.backend.stop()),
  ]);
}

async function createTestControlPlaneWorkflow(input: {
  config: ControlPlaneApiConfig;
  testEnvironmentId: string;
}): Promise<{
  backend: Awaited<ReturnType<typeof createControlPlaneBackend>>;
  openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
}> {
  const backend = await createControlPlaneBackend({
    url: input.config.workflow.databaseUrl,
    namespaceId: createWorkflowNamespaceId({
      prefix: "cp",
      environmentId: input.testEnvironmentId,
    }),
    runMigrations: false,
  });

  return {
    backend,
    openWorkflow: createControlPlaneOpenWorkflow({ backend }),
  };
}

function createWorkflowNamespaceId(input: { prefix: string; environmentId: string }): string {
  return `${input.prefix}_${createSafeIdentifier(input.environmentId)}`;
}

function createControlPlaneTestSchemaName(testEnvironmentId: string): string {
  const normalized = testEnvironmentId.toLowerCase().replaceAll(/[^a-z0-9_]/gu, "_");
  const prefix = /^[a-z]/u.test(normalized) ? normalized : `env_${normalized}`;
  const digest = createHash("sha256").update(testEnvironmentId).digest("hex").slice(0, 10);
  const schemaName = `${prefix.slice(0, 40)}_${digest}_control_plane`;
  if (schemaName.length > 63) {
    throw new Error(
      `Test control-plane schema name '${schemaName}' exceeds Postgres length limits.`,
    );
  }

  return schemaName;
}

function createSafeIdentifier(value: string): string {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9_]/gu, "_");
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 10);
  const compact = normalized.length === 0 ? "env" : normalized.slice(0, 28);
  return `${compact}_${digest}`;
}
