import { createHash } from "node:crypto";

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import type { MistleLogger } from "@mistle/logging";
import type { SandboxAdapter, SandboxRuntimeControl } from "@mistle/sandbox";
import { systemClock, systemSleeper, type Clock, type Sleeper } from "@mistle/time";
import { Pool } from "pg";

import { logger } from "../../logger.js";
import { createSandboxRuntimeStateReader } from "../../runtime-state/create-sandbox-runtime-state-reader.js";
import type { SandboxRuntimeStateReader } from "../../runtime-state/sandbox-runtime-state-reader.js";
import { createDataPlaneWorkerRuntimeConfig, type DataPlaneWorkerRuntimeConfig } from "./config.js";
import { getOpenWorkflowRuntime } from "./runtime.js";
import {
  createSandboxRuntimeAdapter,
  createSandboxRuntimeControl,
} from "./sandbox-runtime-adapter.js";
import { DataPlaneWorkerTunnelTokenDurations } from "./tunnel-token-durations.js";

const DefaultTestEnvironmentIdHeader = "x-mistle-test-environment-id";

export type WorkflowContext = {
  config: DataPlaneWorkerRuntimeConfig;
  logger: MistleLogger;
  db: DataPlaneDatabase;
  dbPool: Pool;
  sandboxAdapter: SandboxAdapter;
  sandboxRuntimeControl: SandboxRuntimeControl;
  runtimeStateReader: SandboxRuntimeStateReader;
  controlPlaneInternalClient: ControlPlaneInternalClient;
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

function createDefaultTunnelReadinessPolicy(): {
  timeoutMs: number;
  pollIntervalMs: number;
} {
  const bootstrapTokenTtlSeconds = DataPlaneWorkerTunnelTokenDurations.BOOTSTRAP_TOKEN_TTL_SECONDS;
  if (!Number.isFinite(bootstrapTokenTtlSeconds) || bootstrapTokenTtlSeconds <= 0) {
    throw new Error("Expected tunnel bootstrap token TTL seconds to be a positive number.");
  }

  return {
    timeoutMs: bootstrapTokenTtlSeconds * 1000,
    pollIntervalMs: 250,
  };
}

async function createWorkflowContext(): Promise<WorkflowContext> {
  const { workerConfig } = await getOpenWorkflowRuntime();
  const config = createDataPlaneWorkerRuntimeConfig({ app: workerConfig });
  const testIsolation = readTestIsolationEnv();
  const dbPool = new Pool({
    connectionString: workerConfig.database.url,
  });
  let sandboxRuntimeControl: SandboxRuntimeControl | undefined;

  try {
    sandboxRuntimeControl = createSandboxRuntimeControl(config);
    const controlPlaneInternalClient =
      testIsolation === undefined
        ? new ControlPlaneInternalClient({
            baseUrl: workerConfig.controlPlaneApi.baseUrl,
            internalAuthServiceToken: workerConfig.internalAuth.serviceToken,
          })
        : new ControlPlaneInternalClient({
            baseUrl: workerConfig.controlPlaneApi.baseUrl,
            internalAuthServiceToken: workerConfig.internalAuth.serviceToken,
            testEnvironmentId: testIsolation.testEnvironmentId,
            testEnvironmentIdHeader: testIsolation.testEnvironmentIdHeader,
          });
    const db =
      testIsolation === undefined
        ? createDataPlaneDatabase(dbPool)
        : createDataPlaneDatabase(dbPool, {
            schemaName: createDataPlaneTestSchemaName(testIsolation.testEnvironmentId),
          });
    const runtimeStateReader =
      testIsolation === undefined
        ? createSandboxRuntimeStateReader({
            gatewayBaseUrl: workerConfig.runtimeState.gatewayBaseUrl,
            serviceToken: workerConfig.internalAuth.serviceToken,
          })
        : createSandboxRuntimeStateReader({
            gatewayBaseUrl: workerConfig.runtimeState.gatewayBaseUrl,
            serviceToken: workerConfig.internalAuth.serviceToken,
            testEnvironmentId: testIsolation.testEnvironmentId,
            testEnvironmentIdHeader: testIsolation.testEnvironmentIdHeader,
          });

    return {
      config,
      logger,
      db,
      dbPool,
      sandboxAdapter: createSandboxRuntimeAdapter(config),
      sandboxRuntimeControl,
      runtimeStateReader,
      controlPlaneInternalClient,
      tunnelReadinessPolicy: createDefaultTunnelReadinessPolicy(),
      clock: systemClock,
      sleeper: systemSleeper,
    };
  } catch (error) {
    await sandboxRuntimeControl?.close();
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

function createDataPlaneTestSchemaName(testEnvironmentId: string): string {
  const normalized = testEnvironmentId.toLowerCase().replaceAll(/[^a-z0-9_]/gu, "_");
  const prefix = /^[a-z]/u.test(normalized) ? normalized : `env_${normalized}`;
  const digest = createHash("sha256").update(testEnvironmentId).digest("hex").slice(0, 10);
  const schemaName = `${prefix.slice(0, 40)}_${digest}_data_plane`;
  if (schemaName.length > 63) {
    throw new Error(`Test data-plane schema name '${schemaName}' exceeds Postgres limits.`);
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
    await context.sandboxRuntimeControl.close();
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
