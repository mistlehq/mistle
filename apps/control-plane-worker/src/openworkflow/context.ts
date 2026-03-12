import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";
import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  createControlPlaneOpenWorkflow,
  type ControlPlaneAutomationConversationDeliveryServices,
  type ControlPlaneAutomationRunServices,
  type ControlPlaneIntegrationConnectionResourceServices,
  type ControlPlaneIntegrationWebhookServices,
  type ControlPlaneSandboxInstanceServices,
  type ControlPlaneSandboxProfileServices,
  type ControlPlaneWorkerEmailDelivery,
} from "@mistle/workflows/control-plane";
import { Pool } from "pg";

import { createControlPlaneWorkerServices } from "../runtime/services/index.js";
import { getOpenWorkflowRuntime } from "./runtime.js";

type RequiredWorkflowServices = {
  automationConversationDelivery: ControlPlaneAutomationConversationDeliveryServices;
  automationRuns: ControlPlaneAutomationRunServices;
  emailDelivery: ControlPlaneWorkerEmailDelivery;
  integrationConnectionResources: ControlPlaneIntegrationConnectionResourceServices;
  integrationWebhooks: ControlPlaneIntegrationWebhookServices;
  sandboxInstances: ControlPlaneSandboxInstanceServices;
  sandboxProfiles: ControlPlaneSandboxProfileServices;
};

export type WorkflowContext = {
  db: ControlPlaneDatabase;
  dbPool: Pool;
  openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
  services: RequiredWorkflowServices;
};

let workflowContextPromise: Promise<WorkflowContext> | undefined;
let closeWorkflowContextPromise: Promise<void> | undefined;
let shutdownHandlersRegistered = false;

function requireWorkflowServices(
  services: ReturnType<typeof createControlPlaneWorkerServices>,
): RequiredWorkflowServices {
  if (services.automationConversationDelivery === undefined) {
    throw new Error("Expected automation conversation delivery workflow services.");
  }
  if (services.automationRuns === undefined) {
    throw new Error("Expected automation run workflow services.");
  }
  if (services.emailDelivery === undefined) {
    throw new Error("Expected email delivery workflow services.");
  }
  if (services.integrationConnectionResources === undefined) {
    throw new Error("Expected integration connection resource workflow services.");
  }
  if (services.integrationWebhooks === undefined) {
    throw new Error("Expected integration webhook workflow services.");
  }
  if (services.sandboxInstances === undefined) {
    throw new Error("Expected sandbox instance workflow services.");
  }
  if (services.sandboxProfiles === undefined) {
    throw new Error("Expected sandbox profile workflow services.");
  }

  return {
    automationConversationDelivery: services.automationConversationDelivery,
    automationRuns: services.automationRuns,
    emailDelivery: services.emailDelivery,
    integrationConnectionResources: services.integrationConnectionResources,
    integrationWebhooks: services.integrationWebhooks,
    sandboxInstances: services.sandboxInstances,
    sandboxProfiles: services.sandboxProfiles,
  };
}

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
    const dataPlaneSandboxInstancesClient = createDataPlaneSandboxInstancesClient({
      baseUrl: workerConfig.dataPlaneApi.baseUrl,
      serviceToken: globalConfig.internalAuth.serviceToken,
    });
    const services = createControlPlaneWorkerServices({
      config: workerConfig,
      internalAuthServiceToken: globalConfig.internalAuth.serviceToken,
      db,
      openWorkflow,
      dataPlaneSandboxInstancesClient,
    });

    return {
      db,
      dbPool,
      openWorkflow,
      services: requireWorkflowServices(services),
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
