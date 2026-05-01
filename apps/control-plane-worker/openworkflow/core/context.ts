import { createHash } from "node:crypto";

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";
import { Pool } from "pg";

import { createControlPlaneOpenWorkflow } from "./client.js";
import { createEmailSender, type ControlPlaneWorkerEmailDelivery } from "./email.js";
import { getOpenWorkflowRuntime } from "./runtime.js";

const ControlPlaneInternalRequestTimeoutMs = 60_000;
const DefaultTestEnvironmentIdHeader = "x-mistle-test-environment-id";

export type WorkflowContext = {
  db: ControlPlaneDatabase;
  dbPool: Pool;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  dataPlaneClient: DataPlaneSandboxInstancesClient;
  defaultBaseImage: string;
  emailDelivery: ControlPlaneWorkerEmailDelivery;
  integrationRegistry: IntegrationRegistry;
  openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
};

let workflowContextPromise: Promise<WorkflowContext> | undefined;
let closeWorkflowContextPromise: Promise<void> | undefined;
let shutdownHandlersRegistered = false;

async function createWorkflowContext(): Promise<WorkflowContext> {
  const { backend, workerConfig } = await getOpenWorkflowRuntime();
  const testIsolation = readTestIsolationEnv();
  const dbPool = new Pool({
    connectionString: workerConfig.workflow.databaseUrl,
  });

  try {
    const db =
      testIsolation === undefined
        ? createControlPlaneDatabase(dbPool)
        : createControlPlaneDatabase(dbPool, {
            schemaName: createControlPlaneTestSchemaName(testIsolation.testEnvironmentId),
          });
    const openWorkflow = createControlPlaneOpenWorkflow({
      backend,
    });
    const dataPlaneClient =
      testIsolation === undefined
        ? createDataPlaneSandboxInstancesClient({
            baseUrl: workerConfig.dataPlaneApi.baseUrl,
            serviceToken: workerConfig.internalAuth.serviceToken,
          })
        : createDataPlaneSandboxInstancesClient({
            baseUrl: workerConfig.dataPlaneApi.baseUrl,
            serviceToken: workerConfig.internalAuth.serviceToken,
            testEnvironmentId: testIsolation.testEnvironmentId,
            testEnvironmentIdHeader: testIsolation.testEnvironmentIdHeader,
          });
    const controlPlaneInternalClient =
      testIsolation === undefined
        ? new ControlPlaneInternalClient({
            baseUrl: workerConfig.controlPlaneApi.baseUrl,
            internalAuthServiceToken: workerConfig.internalAuth.serviceToken,
            requestTimeoutMs: ControlPlaneInternalRequestTimeoutMs,
          })
        : new ControlPlaneInternalClient({
            baseUrl: workerConfig.controlPlaneApi.baseUrl,
            internalAuthServiceToken: workerConfig.internalAuth.serviceToken,
            requestTimeoutMs: ControlPlaneInternalRequestTimeoutMs,
            testEnvironmentId: testIsolation.testEnvironmentId,
            testEnvironmentIdHeader: testIsolation.testEnvironmentIdHeader,
          });
    const emailDelivery = {
      emailSender: createEmailSender(workerConfig),
      from: {
        email: workerConfig.email.fromAddress,
        name: workerConfig.email.fromName,
      },
    } satisfies ControlPlaneWorkerEmailDelivery;
    const integrationRegistry = createIntegrationRegistry();

    return {
      controlPlaneInternalClient,
      dataPlaneClient,
      db,
      dbPool,
      defaultBaseImage: workerConfig.sandbox.defaultBaseImage,
      emailDelivery,
      integrationRegistry,
      openWorkflow,
    };
  } catch (error) {
    await dbPool.end();
    throw error;
  }
}

function readTestIsolationEnv():
  | {
      testEnvironmentId: string;
      testEnvironmentIdHeader: string;
    }
  | undefined {
  const testEnvironmentId = process.env.MISTLE_TEST_ENVIRONMENT_ID;
  if (testEnvironmentId === undefined || testEnvironmentId.length === 0) {
    return undefined;
  }

  return {
    testEnvironmentId,
    testEnvironmentIdHeader:
      process.env.MISTLE_TEST_ENVIRONMENT_ID_HEADER ?? DefaultTestEnvironmentIdHeader,
  };
}

function createControlPlaneTestSchemaName(testEnvironmentId: string): string {
  const normalized = testEnvironmentId.toLowerCase().replaceAll(/[^a-z0-9_]/gu, "_");
  const prefix = /^[a-z]/u.test(normalized) ? normalized : `env_${normalized}`;
  const digest = createHash("sha256").update(testEnvironmentId).digest("hex").slice(0, 10);
  const schemaName = `${prefix.slice(0, 40)}_${digest}_control_plane`;
  if (schemaName.length > 63) {
    throw new Error(`Test control-plane schema name '${schemaName}' exceeds Postgres limits.`);
  }

  return schemaName;
}

export function getWorkflowContext(): Promise<WorkflowContext> {
  if (workflowContextPromise !== undefined) {
    return workflowContextPromise;
  }

  workflowContextPromise = createWorkflowContext().catch((error: unknown) => {
    workflowContextPromise = undefined;
    throw error;
  });

  return workflowContextPromise;
}

export async function closeWorkflowContext(): Promise<void> {
  const contextPromise = workflowContextPromise;
  if (contextPromise === undefined) {
    return;
  }

  if (closeWorkflowContextPromise !== undefined) {
    await closeWorkflowContextPromise;
    return;
  }

  closeWorkflowContextPromise = (async () => {
    const context = await contextPromise;
    await context.dbPool.end();
    workflowContextPromise = undefined;
    closeWorkflowContextPromise = undefined;
  })().catch((error: unknown) => {
    closeWorkflowContextPromise = undefined;
    throw error;
  });

  await closeWorkflowContextPromise;
}

export function registerWorkflowContextShutdownHandlers(): void {
  if (shutdownHandlersRegistered) {
    return;
  }

  function handleSignal(): void {
    void closeWorkflowContext();
  }

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  shutdownHandlersRegistered = true;
}
