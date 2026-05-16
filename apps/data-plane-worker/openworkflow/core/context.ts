import { AsyncLocalStorage } from "node:async_hooks";

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  createDataPlaneDatabase,
  getDataPlaneDatabaseSchema,
  type DataPlaneDatabase,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import { createDataPlaneTestSchemaName } from "@mistle/db/test-environment";
import type { MistleLogger } from "@mistle/logging";
import { systemClock, systemSleeper, type Clock, type Sleeper } from "@mistle/time";
import { Pool } from "pg";

import { logger } from "../../logger.js";
import { createSandboxBootstrapAttachmentTerminator } from "../../runtime-state/create-sandbox-bootstrap-attachment-terminator.js";
import { createSandboxRuntimeStateReader } from "../../runtime-state/create-sandbox-runtime-state-reader.js";
import type { SandboxBootstrapAttachmentTerminator } from "../../runtime-state/sandbox-bootstrap-attachment-terminator.js";
import type { SandboxRuntimeStateReader } from "../../runtime-state/sandbox-runtime-state-reader.js";
import { createDataPlaneWorkerRuntimeConfig, type DataPlaneWorkerRuntimeConfig } from "./config.js";
import { readServiceReleaseVersion } from "./release-version.js";
import { getOpenWorkflowRuntime, type OpenWorkflowRuntime } from "./runtime.js";
import {
  createSandboxRuntimeProviderResolver,
  type SandboxRuntimeProviderResolver,
} from "./sandbox-runtime-resolver.js";
import {
  createSandboxdArtifactResolver,
  type SandboxdArtifactResolver,
} from "./sandboxd-artifact-resolver.js";
import { DataPlaneWorkerTunnelTokenDurations } from "./tunnel-token-durations.js";

const DefaultTestEnvironmentIdHeader = "x-mistle-test-environment-id";

export type WorkflowContext = {
  config: DataPlaneWorkerRuntimeConfig;
  processEnv: Readonly<Record<string, string | undefined>>;
  logger: MistleLogger;
  db: DataPlaneDatabase;
  tables: DataPlaneTables;
  dbPool: Pool;
  sandboxRuntimeProviderResolver: SandboxRuntimeProviderResolver;
  sandboxdArtifactResolver: SandboxdArtifactResolver | undefined;
  runtimeStateReader: SandboxRuntimeStateReader;
  bootstrapAttachmentTerminator: SandboxBootstrapAttachmentTerminator;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  tunnelReadinessPolicy: {
    timeoutMs: number;
    pollIntervalMs: number;
  };
  clock: Clock;
  sleeper: Sleeper;
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

async function createWorkflowContext(input?: {
  runtime?: OpenWorkflowRuntime;
  testIsolation?: WorkflowTestIsolation;
  dbPool?: Pool;
  processEnv?: Readonly<Record<string, string | undefined>>;
}): Promise<HostedWorkflowContext> {
  const { environment, workerConfig } = input?.runtime ?? (await getOpenWorkflowRuntime());
  const config = createDataPlaneWorkerRuntimeConfig({ app: workerConfig });
  const processEnv = input?.processEnv ?? process.env;
  const testIsolation = input?.testIsolation ?? readTestIsolationEnv();
  const dbPool =
    input?.dbPool ??
    new Pool({
      connectionString: workerConfig.database.url,
    });
  const ownsDbPool = input?.dbPool === undefined;

  try {
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
    const tables = getDataPlaneDatabaseSchema(db);
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
    const bootstrapAttachmentTerminator =
      testIsolation === undefined
        ? createSandboxBootstrapAttachmentTerminator({
            gatewayBaseUrl: workerConfig.runtimeState.gatewayBaseUrl,
            serviceToken: workerConfig.internalAuth.serviceToken,
          })
        : createSandboxBootstrapAttachmentTerminator({
            gatewayBaseUrl: workerConfig.runtimeState.gatewayBaseUrl,
            serviceToken: workerConfig.internalAuth.serviceToken,
            testEnvironmentId: testIsolation.testEnvironmentId,
            testEnvironmentIdHeader: testIsolation.testEnvironmentIdHeader,
          });
    const sandboxdArtifactResolver =
      environment === "production"
        ? createSandboxdArtifactResolver({
            releaseVersion: readServiceReleaseVersion(),
          })
        : undefined;

    return {
      context: {
        config,
        processEnv,
        logger,
        db,
        tables,
        dbPool,
        sandboxRuntimeProviderResolver: createSandboxRuntimeProviderResolver({
          config,
          controlPlaneInternalClient,
          ...(sandboxdArtifactResolver === undefined ? {} : { sandboxdArtifactResolver }),
        }),
        sandboxdArtifactResolver,
        runtimeStateReader,
        bootstrapAttachmentTerminator,
        controlPlaneInternalClient,
        tunnelReadinessPolicy: createDefaultTunnelReadinessPolicy(),
        clock: systemClock,
        sleeper: systemSleeper,
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
  processEnv?: Readonly<Record<string, string | undefined>>;
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
