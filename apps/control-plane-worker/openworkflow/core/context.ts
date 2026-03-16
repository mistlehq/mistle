import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions";
import { Pool } from "pg";

import { createEmailSender } from "../../src/runtime/services/create-email-sender.js";
import type { ControlPlaneWorkerEmailDelivery } from "../../src/runtime/workflow-types.js";
import { createControlPlaneOpenWorkflow } from "./client.js";
import { getOpenWorkflowRuntime } from "./runtime.js";

export type WorkflowContext = {
  db: ControlPlaneDatabase;
  dbPool: Pool;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  dataPlaneClient: DataPlaneSandboxInstancesClient;
  emailDelivery: ControlPlaneWorkerEmailDelivery;
  integrationRegistry: IntegrationRegistry;
  openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
};

let workflowContextPromise: Promise<WorkflowContext> | undefined;
let closeWorkflowContextPromise: Promise<void> | undefined;
let shutdownHandlersRegistered = false;

async function createWorkflowContext(): Promise<WorkflowContext> {
  const { backend, globalConfig, workerConfig } = await getOpenWorkflowRuntime();
  const dbPool = new Pool({
    connectionString: workerConfig.workflow.databaseUrl,
  });

  try {
    const db = createControlPlaneDatabase(dbPool);
    const openWorkflow = createControlPlaneOpenWorkflow({
      backend,
    });
    const dataPlaneClient = createDataPlaneSandboxInstancesClient({
      baseUrl: workerConfig.dataPlaneApi.baseUrl,
      serviceToken: globalConfig.internalAuth.serviceToken,
    });
    const controlPlaneInternalClient = new ControlPlaneInternalClient({
      baseUrl: workerConfig.controlPlaneApi.baseUrl,
      internalAuthServiceToken: globalConfig.internalAuth.serviceToken,
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
      emailDelivery,
      integrationRegistry,
      openWorkflow,
    };
  } catch (error) {
    await dbPool.end();
    throw error;
  }
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
