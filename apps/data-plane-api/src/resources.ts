import { createHash } from "node:crypto";

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import type { SandboxAdapter } from "@mistle/sandbox";
import { Pool } from "pg";

import { createDataPlaneBackend, createDataPlaneOpenWorkflow } from "./openworkflow/index.js";
import { GatewayHttpSandboxRuntimeStateReader } from "./runtime-state/gateway-http-sandbox-runtime-state-reader.js";
import type { SandboxRuntimeStateReader } from "./runtime-state/sandbox-runtime-state-reader.js";
import { createSandboxRuntimeAdapter } from "./sandbox/adapter.js";
import type { DataPlaneApiRuntimeConfig } from "./types.js";

export type AppRuntimeResources = {
  db: DataPlaneDatabase;
  dbPool: Pool;
  workflowDbPool: Pool;
  workflowBackend: Awaited<ReturnType<typeof createDataPlaneBackend>>;
  openWorkflow: ReturnType<typeof createDataPlaneOpenWorkflow>;
  runtimeStateReader: SandboxRuntimeStateReader;
  sandboxAdapter: SandboxAdapter;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  testWorkflowsByEnvironmentId: ReadonlyMap<
    string,
    Promise<{
      backend: Awaited<ReturnType<typeof createDataPlaneBackend>>;
      openWorkflow: ReturnType<typeof createDataPlaneOpenWorkflow>;
    }>
  >;
  getDb: (input?: { testEnvironmentId?: string }) => DataPlaneDatabase;
  getOpenWorkflow: (input?: {
    testEnvironmentId?: string;
  }) => Promise<ReturnType<typeof createDataPlaneOpenWorkflow>>;
  getWorkflowNamespaceId: (input?: { testEnvironmentId?: string }) => string;
  getRuntimeStateReader: (input?: { testEnvironmentId?: string }) => SandboxRuntimeStateReader;
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
  const testDbsByEnvironmentId = new Map<string, DataPlaneDatabase>();
  const testWorkflowsByEnvironmentId = new Map<
    string,
    Promise<{
      backend: Awaited<ReturnType<typeof createDataPlaneBackend>>;
      openWorkflow: ReturnType<typeof createDataPlaneOpenWorkflow>;
    }>
  >();
  const testRuntimeStateReadersByEnvironmentId = new Map<string, SandboxRuntimeStateReader>();
  const runtimeStateReader = new GatewayHttpSandboxRuntimeStateReader({
    baseUrl: runtimeConfig.app.runtimeState.gatewayBaseUrl,
    serviceToken: runtimeConfig.app.internalAuth.serviceToken,
  });
  const controlPlaneInternalClient = new ControlPlaneInternalClient({
    baseUrl: runtimeConfig.app.controlPlaneApi.baseUrl,
    internalAuthServiceToken: runtimeConfig.app.internalAuth.serviceToken,
  });
  const sandboxAdapter = createSandboxRuntimeAdapter(runtimeConfig);

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

  return {
    db,
    dbPool,
    workflowDbPool,
    workflowBackend,
    openWorkflow,
    runtimeStateReader,
    sandboxAdapter,
    controlPlaneInternalClient,
    testWorkflowsByEnvironmentId,
    getDb: (request = {}) => {
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
    },
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

      return createWorkflowNamespaceId({
        prefix: "dp",
        environmentId: testEnvironmentId,
      });
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
  };
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
    namespaceId: createWorkflowNamespaceId({
      prefix: "dp",
      environmentId: input.testEnvironmentId,
    }),
    runMigrations: false,
  });

  return {
    backend,
    openWorkflow: createDataPlaneOpenWorkflow({ backend }),
  };
}

function createWorkflowNamespaceId(input: { prefix: string; environmentId: string }): string {
  return `${input.prefix}_${createSafeIdentifier(input.environmentId)}`;
}

function createDataPlaneTestSchemaName(testEnvironmentId: string): string {
  const normalized = testEnvironmentId.toLowerCase().replaceAll(/[^a-z0-9_]/gu, "_");
  const prefix = /^[a-z]/u.test(normalized) ? normalized : `env_${normalized}`;
  const digest = createHash("sha256").update(testEnvironmentId).digest("hex").slice(0, 10);
  const schemaName = `${prefix.slice(0, 40)}_${digest}_data_plane`;
  if (schemaName.length > 63) {
    throw new Error(`Test data-plane schema name '${schemaName}' exceeds Postgres length limits.`);
  }

  return schemaName;
}

function createSafeIdentifier(value: string): string {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9_]/gu, "_");
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 10);
  const compact = normalized.length === 0 ? "env" : normalized.slice(0, 28);
  return `${compact}_${digest}`;
}
