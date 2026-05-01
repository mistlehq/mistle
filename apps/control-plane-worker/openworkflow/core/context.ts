import { AsyncLocalStorage } from "node:async_hooks";

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  createControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
  type ControlPlaneDatabase,
  type ControlPlaneTables,
} from "@mistle/db/control-plane";
import { createControlPlaneTestSchemaName } from "@mistle/db/test-environment";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";
import { Pool } from "pg";

import { createControlPlaneOpenWorkflow } from "./client.js";
import { createEmailSender, type ControlPlaneWorkerEmailDelivery } from "./email.js";
import { getOpenWorkflowRuntime, type OpenWorkflowRuntime } from "./runtime.js";

const ControlPlaneInternalRequestTimeoutMs = 60_000;
const DefaultTestEnvironmentIdHeader = "x-mistle-test-environment-id";

export type WorkflowContext = {
  db: ControlPlaneDatabase;
  tables: ControlPlaneTables;
  dbPool: Pool;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  dataPlaneClient: DataPlaneSandboxInstancesClient;
  defaultBaseImage: string;
  emailDelivery: ControlPlaneWorkerEmailDelivery;
  integrationRegistry: IntegrationRegistry;
  openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
};

export type WorkflowTestIsolation = {
  testEnvironmentId: string;
  testEnvironmentIdHeader: string;
};

export type HostedWorkflowContext = {
  context: WorkflowContext;
  close: () => Promise<void>;
};

let workflowContextPromise: Promise<WorkflowContext> | undefined;
let closeWorkflowContextPromise: Promise<void> | undefined;
let shutdownHandlersRegistered = false;
const hostedWorkflowContextStorage = new AsyncLocalStorage<WorkflowContext>();

async function createWorkflowContext(input?: {
  runtime?: OpenWorkflowRuntime;
  testIsolation?: WorkflowTestIsolation;
  dbPool?: Pool;
}): Promise<HostedWorkflowContext> {
  const { backend, workerConfig } = input?.runtime ?? (await getOpenWorkflowRuntime());
  const testIsolation = input?.testIsolation ?? readTestIsolationEnv();
  const dbPool =
    input?.dbPool ??
    new Pool({
      connectionString: workerConfig.workflow.databaseUrl,
    });
  const ownsDbPool = input?.dbPool === undefined;

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
      context: {
        controlPlaneInternalClient,
        dataPlaneClient,
        db,
        tables: getControlPlaneDatabaseSchema(db),
        dbPool,
        defaultBaseImage: workerConfig.sandbox.defaultBaseImage,
        emailDelivery,
        integrationRegistry,
        openWorkflow,
      },
      close: async () => {
        if (ownsDbPool) {
          await dbPool.end();
        }
      },
    };
  } catch (error) {
    if (ownsDbPool) {
      await dbPool.end();
    }
    throw error;
  }
}

function readTestIsolationEnv(): WorkflowTestIsolation | undefined {
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

export function getWorkflowContext(): Promise<WorkflowContext> {
  const hostedContext = hostedWorkflowContextStorage.getStore();
  if (hostedContext !== undefined) {
    return Promise.resolve(hostedContext);
  }

  if (workflowContextPromise !== undefined) {
    return workflowContextPromise;
  }

  workflowContextPromise = createWorkflowContext()
    .then((hostedContext) => hostedContext.context)
    .catch((error: unknown) => {
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

export async function createHostedWorkflowContext(input: {
  runtime: OpenWorkflowRuntime;
  testIsolation: WorkflowTestIsolation;
  dbPool: Pool;
}): Promise<HostedWorkflowContext> {
  return createWorkflowContext(input);
}

export function withHostedWorkflowContext<T>(
  context: WorkflowContext,
  callback: () => Promise<T> | T,
): Promise<T> | T {
  return hostedWorkflowContextStorage.run(context, callback);
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
