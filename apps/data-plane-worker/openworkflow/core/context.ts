import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import type { SandboxAdapter } from "@mistle/sandbox";
import { systemClock, systemSleeper, type Clock, type Sleeper } from "@mistle/time";
import { Pool } from "pg";

import { createSandboxRuntimeStateReader } from "../../runtime-state/create-sandbox-runtime-state-reader.js";
import type { SandboxRuntimeStateReader } from "../../runtime-state/sandbox-runtime-state-reader.js";
import type { DataPlaneWorkerRuntimeConfig } from "./config.js";
import { getOpenWorkflowRuntime } from "./runtime.js";
import { createSandboxRuntimeAdapter } from "./sandbox-runtime-adapter.js";
import {
  createSandboxStartupConfigurator,
  type SandboxStartupConfigurator,
} from "./sandbox-startup-configurator.js";

export type WorkflowContext = {
  config: DataPlaneWorkerRuntimeConfig;
  db: DataPlaneDatabase;
  dbPool: Pool;
  sandboxAdapter: SandboxAdapter;
  startupConfigurator: SandboxStartupConfigurator;
  runtimeStateReader: SandboxRuntimeStateReader;
  tunnelReadinessPolicy: {
    timeoutMs: number;
    pollIntervalMs: number;
  };
  clock: Clock;
  sleeper: Sleeper;
};

let workflowContextPromise: Promise<WorkflowContext> | undefined;
let closeWorkflowContextPromise: Promise<void> | undefined;
let shutdownHandlersRegistered = false;

function createDefaultTunnelReadinessPolicy(config: DataPlaneWorkerRuntimeConfig): {
  timeoutMs: number;
  pollIntervalMs: number;
} {
  const bootstrapTokenTtlSeconds = config.app.tunnel.bootstrapTokenTtlSeconds;
  if (!Number.isFinite(bootstrapTokenTtlSeconds) || bootstrapTokenTtlSeconds <= 0) {
    throw new Error("Expected tunnel bootstrap token TTL seconds to be a positive number.");
  }

  return {
    timeoutMs: bootstrapTokenTtlSeconds * 1000,
    pollIntervalMs: 250,
  };
}

async function createWorkflowContext(): Promise<WorkflowContext> {
  const { globalConfig, workerConfig } = await getOpenWorkflowRuntime();
  const config: DataPlaneWorkerRuntimeConfig = {
    app: workerConfig,
    sandbox: globalConfig.sandbox,
    telemetry: globalConfig.telemetry,
  };
  const dbPool = new Pool({
    connectionString: workerConfig.database.url,
  });
  let startupConfigurator: SandboxStartupConfigurator | undefined;

  try {
    startupConfigurator = createSandboxStartupConfigurator(config);

    return {
      config,
      db: createDataPlaneDatabase(dbPool),
      dbPool,
      sandboxAdapter: createSandboxRuntimeAdapter(config),
      startupConfigurator,
      runtimeStateReader: createSandboxRuntimeStateReader({
        gatewayBaseUrl: workerConfig.runtimeState.gatewayBaseUrl,
        serviceToken: globalConfig.internalAuth.serviceToken,
      }),
      tunnelReadinessPolicy: createDefaultTunnelReadinessPolicy(config),
      clock: systemClock,
      sleeper: systemSleeper,
    };
  } catch (error) {
    await startupConfigurator?.close();
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
    await context.startupConfigurator.close();
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
