import {
  Cache,
  InMemoryCacheAdapter,
  ValkeyCacheAdapter,
  closeValkeyClient,
  connectValkeyClient,
  createValkeyClient,
} from "@mistle/cache";
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
import { logger } from "./logger.js";
import { createControlPlaneBackend, createControlPlaneOpenWorkflow } from "./openworkflow.js";
import type { ControlPlaneApiConfig } from "./types.js";

type ResourceStartupCleanupTask = () => Promise<void> | void;

export type AppRequestContext = {
  db: ControlPlaneDatabase;
  openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
  auth: ReturnType<typeof createControlPlaneAuth>;
};

export type AppRuntimeResources = {
  db: ControlPlaneDatabase;
  dbPool: Pool;
  cache: Cache;
  closeCache: () => Promise<void>;
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
  let cacheResources: Awaited<ReturnType<typeof createControlPlaneCacheResources>>;
  try {
    cacheResources = await createControlPlaneCacheResources(config);
  } catch (error) {
    await runResourceStartupCleanup([() => dbPool.end()]);
    throw error;
  }
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
      databasePoolMax: config.workflow.databasePoolMax,
    });
  } catch (error) {
    await runResourceStartupCleanup([
      cacheResources.close,
      () => objectStore.destroy(),
      () => dbPool.end(),
    ]);
    throw error;
  }

  const openWorkflow = createControlPlaneOpenWorkflow({ backend: workflowBackend });

  return {
    db,
    dbPool,
    cache: cacheResources.cache,
    closeCache: cacheResources.close,
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
    resources.closeCache(),
    resources.workflowBackend.stop(),
    ...testWorkflows.map((workflow) => workflow.backend.stop()),
  ]);
}

async function runResourceStartupCleanup(
  cleanupTasks: readonly ResourceStartupCleanupTask[],
): Promise<void> {
  const results = await Promise.allSettled(cleanupTasks.map(runResourceStartupCleanupTask));

  for (const result of results) {
    if (result.status === "rejected") {
      logger.warn(
        {
          err: result.reason,
        },
        "Control-plane API resource startup cleanup failed",
      );
    }
  }
}

async function runResourceStartupCleanupTask(task: ResourceStartupCleanupTask): Promise<void> {
  await task();
}

async function createControlPlaneCacheResources(
  config: ControlPlaneApiConfig,
): Promise<{ cache: Cache; close: () => Promise<void> }> {
  if (config.cache.backend === "memory") {
    return {
      cache: new Cache({
        adapter: new InMemoryCacheAdapter(),
      }),
      close: () => Promise.resolve(),
    };
  }

  const valkeyConfig = config.cache.valkey;
  if (valkeyConfig === undefined) {
    throw new Error(
      "Expected control-plane API cache.valkey config when cache.backend is 'valkey'.",
    );
  }

  const valkeyClient = createValkeyClient({
    onError: (error) => {
      logger.error(
        {
          err: error,
        },
        "Control-plane API Valkey cache client error",
      );
    },
    url: valkeyConfig.url,
  });
  const cache = new Cache({
    adapter: new ValkeyCacheAdapter(valkeyClient, valkeyConfig.keyPrefix),
  });

  try {
    await connectValkeyClient(valkeyClient);
  } catch (error) {
    await closeValkeyClient(valkeyClient);
    throw error;
  }

  return {
    cache,
    close: async () => {
      await closeValkeyClient(valkeyClient);
    },
  };
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
    databasePoolMax: input.config.workflow.databasePoolMax,
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
