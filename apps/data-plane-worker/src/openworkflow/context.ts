import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import { systemClock, systemSleeper } from "@mistle/time";
import { Pool } from "pg";

import { createSandboxRuntimeAdapter } from "../runtime/resources.js";
import {
  createDataPlaneWorkerServices,
  createDefaultTunnelReadinessPolicy,
} from "../runtime/services/index.js";
import type { DataPlaneWorkerServices } from "../runtime/workflow-types.js";
import { getOpenWorkflowRuntime } from "./runtime.js";

type RequiredWorkflowServices = {
  startSandboxInstance: DataPlaneWorkerServices["startSandboxInstance"];
  stopSandboxInstance: DataPlaneWorkerServices["stopSandboxInstance"];
};

export type WorkflowContext = {
  db: DataPlaneDatabase;
  dbPool: Pool;
  services: RequiredWorkflowServices;
};

let workflowContextPromise: Promise<WorkflowContext> | undefined;
let closeWorkflowContextPromise: Promise<void> | undefined;
let shutdownHandlersRegistered = false;

function requireWorkflowServices(services: DataPlaneWorkerServices): RequiredWorkflowServices {
  if (services.startSandboxInstance === undefined) {
    throw new Error("Expected start sandbox instance workflow services.");
  }
  if (services.stopSandboxInstance === undefined) {
    throw new Error("Expected stop sandbox instance workflow services.");
  }

  return {
    startSandboxInstance: services.startSandboxInstance,
    stopSandboxInstance: services.stopSandboxInstance,
  };
}

async function createWorkflowContext(): Promise<WorkflowContext> {
  const { globalConfig, workerConfig } = await getOpenWorkflowRuntime();
  const runtimeConfig = {
    app: workerConfig,
    sandbox: globalConfig.sandbox,
    telemetry: globalConfig.telemetry,
  };
  const dbPool = new Pool({
    connectionString: workerConfig.database.url,
  });

  try {
    const db = createDataPlaneDatabase(dbPool);
    const services = createDataPlaneWorkerServices({
      config: runtimeConfig,
      db,
      sandboxAdapter: createSandboxRuntimeAdapter(runtimeConfig),
      tunnelReadinessPolicy: createDefaultTunnelReadinessPolicy(runtimeConfig),
      clock: systemClock,
      sleeper: systemSleeper,
    });

    return {
      db,
      dbPool,
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
