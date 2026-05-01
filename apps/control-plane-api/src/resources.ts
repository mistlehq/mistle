import {
  createControlPlaneDatabase,
  createControlPlaneDbSchema,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import {
  createControlPlaneTestSchemaName,
  createControlPlaneWorkflowNamespaceId,
} from "@mistle/db/test-environment";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";
import { S3CompatibleObjectStore } from "@mistle/object-store";
import { Pool } from "pg";

import { createControlPlaneAuth, type ControlPlaneAuthConfig } from "./auth/index.js";
import { createControlPlaneBackend, createControlPlaneOpenWorkflow } from "./openworkflow.js";
import type { ControlPlaneApiConfig } from "./types.js";

export type AppRequestContext = {
  db: ControlPlaneDatabase;
  openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
  auth: ReturnType<typeof createControlPlaneAuth>;
};

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
  getAppContext: (input: {
    authConfig: ControlPlaneAuthConfig;
    testEnvironmentId?: string;
  }) => Promise<AppRequestContext>;
};

export async function createAppResources(
  config: ControlPlaneApiConfig,
): Promise<AppRuntimeResources> {
  const dbPool = new Pool({
    connectionString: config.database.url,
  });
  const db = createControlPlaneDatabase(dbPool);
  const testDbsByEnvironmentId = new Map<string, ControlPlaneDatabase>();
  let auth: ReturnType<typeof createControlPlaneAuth> | undefined;
  const testAuthByEnvironmentId = new Map<string, ReturnType<typeof createControlPlaneAuth>>();
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

      return createControlPlaneTestDatabase({
        dbPool,
        testDbsByEnvironmentId,
        testEnvironmentId,
      });
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

      return createControlPlaneTestOpenWorkflow({
        config,
        testWorkflowsByEnvironmentId,
        testEnvironmentId,
      });
    },
    getAppContext: async (request) => {
      const testEnvironmentId = request.testEnvironmentId;
      if (
        config.__dangerouslyEnableTestIsolation === undefined ||
        testEnvironmentId === undefined ||
        testEnvironmentId.length === 0
      ) {
        auth ??= createControlPlaneAuth({
          config: request.authConfig,
          db,
          openWorkflow,
        });

        return {
          auth,
          db,
          openWorkflow,
        };
      }

      const testDb = createControlPlaneTestDatabase({
        dbPool,
        testDbsByEnvironmentId,
        testEnvironmentId,
      });
      const testOpenWorkflow = await createControlPlaneTestOpenWorkflow({
        config,
        testWorkflowsByEnvironmentId,
        testEnvironmentId,
      });
      let testAuth = testAuthByEnvironmentId.get(testEnvironmentId);
      if (testAuth === undefined) {
        testAuth = createControlPlaneAuth({
          config: request.authConfig,
          db: testDb,
          tables: createControlPlaneDbSchema(createControlPlaneTestSchemaName(testEnvironmentId)),
          openWorkflow: testOpenWorkflow,
        });
        testAuthByEnvironmentId.set(testEnvironmentId, testAuth);
      }

      return {
        auth: testAuth,
        db: testDb,
        openWorkflow: testOpenWorkflow,
      };
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
    namespaceId: createControlPlaneWorkflowNamespaceId(input.testEnvironmentId),
    runMigrations: false,
  });

  return {
    backend,
    openWorkflow: createControlPlaneOpenWorkflow({ backend }),
  };
}

function createControlPlaneTestDatabase(input: {
  dbPool: Pool;
  testDbsByEnvironmentId: Map<string, ControlPlaneDatabase>;
  testEnvironmentId: string;
}): ControlPlaneDatabase {
  const existingDb = input.testDbsByEnvironmentId.get(input.testEnvironmentId);
  if (existingDb !== undefined) {
    return existingDb;
  }

  const testDb = createControlPlaneDatabase(input.dbPool, {
    schemaName: createControlPlaneTestSchemaName(input.testEnvironmentId),
  });
  input.testDbsByEnvironmentId.set(input.testEnvironmentId, testDb);
  return testDb;
}

async function createControlPlaneTestOpenWorkflow(input: {
  config: ControlPlaneApiConfig;
  testWorkflowsByEnvironmentId: Map<
    string,
    Promise<{
      backend: Awaited<ReturnType<typeof createControlPlaneBackend>>;
      openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
    }>
  >;
  testEnvironmentId: string;
}): Promise<ReturnType<typeof createControlPlaneOpenWorkflow>> {
  const existingWorkflow = input.testWorkflowsByEnvironmentId.get(input.testEnvironmentId);
  if (existingWorkflow !== undefined) {
    return (await existingWorkflow).openWorkflow;
  }

  const workflowPromise = createTestControlPlaneWorkflow({
    config: input.config,
    testEnvironmentId: input.testEnvironmentId,
  });
  input.testWorkflowsByEnvironmentId.set(input.testEnvironmentId, workflowPromise);
  return (await workflowPromise).openWorkflow;
}
