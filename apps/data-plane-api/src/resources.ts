import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  createDataPlaneDatabase,
  getDataPlaneDatabaseSchema,
  type DataPlaneDatabase,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import {
  createDataPlaneTestSchemaName,
  createDataPlaneWorkflowNamespaceId,
} from "@mistle/db/test-environment";
import { Pool } from "pg";

import { createDataPlaneBackend, createDataPlaneOpenWorkflow } from "./openworkflow/index.js";
import { GatewayHttpSandboxRuntimeStateReader } from "./runtime-state/gateway-http-sandbox-runtime-state-reader.js";
import type { SandboxRuntimeStateReader } from "./runtime-state/sandbox-runtime-state-reader.js";
import type { DataPlaneApiRuntimeConfig } from "./types.js";

export type AppRuntimeResources = {
  db: DataPlaneDatabase;
  tables: DataPlaneTables;
  dbPool: Pool;
  workflowDbPool: Pool;
  workflowBackend: Awaited<ReturnType<typeof createDataPlaneBackend>>;
  openWorkflow: ReturnType<typeof createDataPlaneOpenWorkflow>;
  runtimeStateReader: SandboxRuntimeStateReader;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  testWorkflowsByEnvironmentId: ReadonlyMap<
    string,
    Promise<{
      backend: Awaited<ReturnType<typeof createDataPlaneBackend>>;
      openWorkflow: ReturnType<typeof createDataPlaneOpenWorkflow>;
    }>
  >;
  getDb: (input?: { testEnvironmentId?: string }) => DataPlaneDatabase;
  getTables: (input?: { testEnvironmentId?: string }) => DataPlaneTables;
  getOpenWorkflow: (input?: {
    testEnvironmentId?: string;
  }) => Promise<ReturnType<typeof createDataPlaneOpenWorkflow>>;
  getWorkflowNamespaceId: (input?: { testEnvironmentId?: string }) => string;
  getRuntimeStateReader: (input?: { testEnvironmentId?: string }) => SandboxRuntimeStateReader;
  getControlPlaneInternalClient: (input?: {
    testEnvironmentId?: string;
  }) => ControlPlaneInternalClient;
};

export async function createAppResources(
  runtimeConfig: DataPlaneApiRuntimeConfig,
): Promise<AppRuntimeResources> {
  const dbPool = new Pool({
    connectionString: runtimeConfig.app.database.url,
  });
  const workflowDbPool = new Pool({
    connectionString: runtimeConfig.app.workflow.databaseUrl,
  });
  const db = createDataPlaneDatabase(dbPool);
  const tables = getDataPlaneDatabaseSchema(db);
  const testDbsByEnvironmentId = new Map<string, DataPlaneDatabase>();
  const testWorkflowsByEnvironmentId = new Map<
    string,
    Promise<{
      backend: Awaited<ReturnType<typeof createDataPlaneBackend>>;
      openWorkflow: ReturnType<typeof createDataPlaneOpenWorkflow>;
    }>
  >();
  const testRuntimeStateReadersByEnvironmentId = new Map<string, SandboxRuntimeStateReader>();
  const testControlPlaneClientsByEnvironmentId = new Map<string, ControlPlaneInternalClient>();
  const runtimeStateReader = new GatewayHttpSandboxRuntimeStateReader({
    baseUrl: runtimeConfig.app.runtimeState.gatewayBaseUrl,
    serviceToken: runtimeConfig.app.internalAuth.serviceToken,
  });
  const controlPlaneInternalClient = new ControlPlaneInternalClient({
    baseUrl: runtimeConfig.app.controlPlaneApi.baseUrl,
    internalAuthServiceToken: runtimeConfig.app.internalAuth.serviceToken,
  });
  let workflowBackend: Awaited<ReturnType<typeof createDataPlaneBackend>>;

  try {
    workflowBackend = await createDataPlaneBackend({
      url: runtimeConfig.app.workflow.databaseUrl,
      namespaceId: runtimeConfig.app.workflow.namespaceId,
      runMigrations: false,
    });
  } catch (error) {
    await workflowDbPool.end();
    await dbPool.end();
    throw error;
  }

  const openWorkflow = createDataPlaneOpenWorkflow({ backend: workflowBackend });
  const testTablesByEnvironmentId = new Map<string, DataPlaneTables>();

  return {
    db,
    tables,
    dbPool,
    workflowDbPool,
    workflowBackend,
    openWorkflow,
    runtimeStateReader,
    controlPlaneInternalClient,
    testWorkflowsByEnvironmentId,
    getDb: (request = {}) => getDataPlaneDb(request),
    getTables: (request = {}) => getDataPlaneTables(request),
    getOpenWorkflow: async (request = {}) => {
      const testIsolation = runtimeConfig.app.__dangerouslyEnableTestIsolation;
      if (testIsolation === undefined) {
        return openWorkflow;
      }

      const testEnvironmentId = request.testEnvironmentId;
      if (testEnvironmentId === undefined || testEnvironmentId.length === 0) {
        throw new Error("Expected test environment id for isolated data-plane workflow request.");
      }

      const existingWorkflow = testWorkflowsByEnvironmentId.get(testEnvironmentId);
      if (existingWorkflow !== undefined) {
        return (await existingWorkflow).openWorkflow;
      }

      const workflowPromise = createTestDataPlaneWorkflow({
        runtimeConfig,
        testEnvironmentId,
      });
      testWorkflowsByEnvironmentId.set(testEnvironmentId, workflowPromise);
      return (await workflowPromise).openWorkflow;
    },
    getWorkflowNamespaceId: (request = {}) => {
      const testIsolation = runtimeConfig.app.__dangerouslyEnableTestIsolation;
      if (testIsolation === undefined) {
        return runtimeConfig.app.workflow.namespaceId;
      }

      const testEnvironmentId = request.testEnvironmentId;
      if (testEnvironmentId === undefined || testEnvironmentId.length === 0) {
        throw new Error("Expected test environment id for isolated data-plane workflow namespace.");
      }

      return createDataPlaneWorkflowNamespaceId(testEnvironmentId);
    },
    getRuntimeStateReader: (request = {}) => {
      const testIsolation = runtimeConfig.app.__dangerouslyEnableTestIsolation;
      if (testIsolation === undefined) {
        return runtimeStateReader;
      }

      const testEnvironmentId = request.testEnvironmentId;
      if (testEnvironmentId === undefined || testEnvironmentId.length === 0) {
        throw new Error(
          "Expected test environment id for isolated data-plane runtime-state request.",
        );
      }

      const existingReader = testRuntimeStateReadersByEnvironmentId.get(testEnvironmentId);
      if (existingReader !== undefined) {
        return existingReader;
      }

      const reader = new GatewayHttpSandboxRuntimeStateReader({
        baseUrl: runtimeConfig.app.runtimeState.gatewayBaseUrl,
        serviceToken: runtimeConfig.app.internalAuth.serviceToken,
        testEnvironmentId,
        testEnvironmentIdHeader: testIsolation.testEnvironmentIdHeader,
      });
      testRuntimeStateReadersByEnvironmentId.set(testEnvironmentId, reader);
      return reader;
    },
    getControlPlaneInternalClient: (request = {}) => {
      const testIsolation = runtimeConfig.app.__dangerouslyEnableTestIsolation;
      if (testIsolation === undefined) {
        return controlPlaneInternalClient;
      }

      const testEnvironmentId = request.testEnvironmentId;
      if (testEnvironmentId === undefined || testEnvironmentId.length === 0) {
        throw new Error(
          "Expected test environment id for isolated data-plane control-plane client request.",
        );
      }

      const existingClient = testControlPlaneClientsByEnvironmentId.get(testEnvironmentId);
      if (existingClient !== undefined) {
        return existingClient;
      }

      const client = new ControlPlaneInternalClient({
        baseUrl: runtimeConfig.app.controlPlaneApi.baseUrl,
        internalAuthServiceToken: runtimeConfig.app.internalAuth.serviceToken,
        testEnvironmentId,
        testEnvironmentIdHeader: testIsolation.testEnvironmentIdHeader,
      });
      testControlPlaneClientsByEnvironmentId.set(testEnvironmentId, client);
      return client;
    },
  };

  function getDataPlaneDb(request: { testEnvironmentId?: string }): DataPlaneDatabase {
    const testIsolation = runtimeConfig.app.__dangerouslyEnableTestIsolation;
    if (testIsolation === undefined) {
      return db;
    }

    const testEnvironmentId = request.testEnvironmentId;
    if (testEnvironmentId === undefined || testEnvironmentId.length === 0) {
      throw new Error("Expected test environment id for isolated data-plane API request.");
    }

    const existingDb = testDbsByEnvironmentId.get(testEnvironmentId);
    if (existingDb !== undefined) {
      return existingDb;
    }

    const testDb = createDataPlaneDatabase(dbPool, {
      schemaName: createDataPlaneTestSchemaName(testEnvironmentId),
    });
    testDbsByEnvironmentId.set(testEnvironmentId, testDb);
    return testDb;
  }

  function getDataPlaneTables(request: { testEnvironmentId?: string }): DataPlaneTables {
    const testIsolation = runtimeConfig.app.__dangerouslyEnableTestIsolation;
    if (testIsolation === undefined) {
      return tables;
    }

    const testEnvironmentId = request.testEnvironmentId;
    if (testEnvironmentId === undefined || testEnvironmentId.length === 0) {
      throw new Error("Expected test environment id for isolated data-plane table request.");
    }

    const existingTables = testTablesByEnvironmentId.get(testEnvironmentId);
    if (existingTables !== undefined) {
      return existingTables;
    }

    const testTables = getDataPlaneDatabaseSchema(getDataPlaneDb({ testEnvironmentId }));
    testTablesByEnvironmentId.set(testEnvironmentId, testTables);
    return testTables;
  }
}

export async function stopAppResources(resources: AppRuntimeResources): Promise<void> {
  const testWorkflows = await Promise.all(resources.testWorkflowsByEnvironmentId.values());
  await Promise.all([
    resources.dbPool.end(),
    resources.workflowDbPool.end(),
    resources.workflowBackend.stop(),
    ...testWorkflows.map((workflow) => workflow.backend.stop()),
  ]);
}

async function createTestDataPlaneWorkflow(input: {
  runtimeConfig: DataPlaneApiRuntimeConfig;
  testEnvironmentId: string;
}): Promise<{
  backend: Awaited<ReturnType<typeof createDataPlaneBackend>>;
  openWorkflow: ReturnType<typeof createDataPlaneOpenWorkflow>;
}> {
  const backend = await createDataPlaneBackend({
    url: input.runtimeConfig.app.workflow.databaseUrl,
    namespaceId: createDataPlaneWorkflowNamespaceId(input.testEnvironmentId),
    runMigrations: false,
  });

  return {
    backend,
    openWorkflow: createDataPlaneOpenWorkflow({ backend }),
  };
}
