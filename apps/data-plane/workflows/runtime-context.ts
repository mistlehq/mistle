import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import { createSandboxAdapter, SandboxProvider, type SandboxAdapter } from "@mistle/sandbox";
import type { BackendPostgres } from "openworkflow/postgres";
import { Pool } from "pg";

import { getDataPlaneWorkerConfig } from "../src/worker/config.js";
import type { DataPlaneWorkerRuntimeConfig } from "../src/worker/types.js";
import { createDataPlaneBackend } from "./backend.js";

export type TunnelConnectAckPolicy = {
  timeoutMs: number;
  pollIntervalMs: number;
};

export type DataPlaneWorkflowRuntime = {
  config: DataPlaneWorkerRuntimeConfig;
  db: DataPlaneDatabase;
  dbPool: Pool;
  sandboxAdapter: SandboxAdapter;
  tunnelConnectAckPolicy: TunnelConnectAckPolicy;
  workflowBackend: BackendPostgres;
};

const SandboxTunnelConnectAckPollIntervalMs = 250;

let workflowRuntimePromise: Promise<DataPlaneWorkflowRuntime> | undefined;

function assertUnreachable(_value: never): never {
  throw new Error("Unsupported sandbox provider.");
}

function createSandboxRuntimeAdapter(config: DataPlaneWorkerRuntimeConfig): SandboxAdapter {
  if (config.sandbox.provider === SandboxProvider.MODAL) {
    if (config.app.sandbox.modal === undefined) {
      throw new Error("Expected data-plane worker modal sandbox config for global provider modal.");
    }

    return createSandboxAdapter({
      provider: config.sandbox.provider,
      modal: {
        tokenId: config.app.sandbox.modal.tokenId,
        tokenSecret: config.app.sandbox.modal.tokenSecret,
        appName: config.app.sandbox.modal.appName,
        environmentName: config.app.sandbox.modal.environmentName,
      },
    });
  }

  if (config.sandbox.provider === "docker") {
    if (config.app.sandbox.docker === undefined) {
      throw new Error(
        "Expected data-plane worker docker sandbox config for global provider docker.",
      );
    }

    return createSandboxAdapter({
      provider: config.sandbox.provider,
      docker: {
        socketPath: config.app.sandbox.docker.socketPath,
        snapshotRepository: config.app.sandbox.docker.snapshotRepository,
      },
    });
  }

  return assertUnreachable(config.sandbox.provider);
}

function createTunnelConnectAckPolicy(
  config: DataPlaneWorkerRuntimeConfig,
): TunnelConnectAckPolicy {
  const bootstrapTokenTtlSeconds = config.app.tunnel.bootstrapTokenTtlSeconds;

  if (!Number.isFinite(bootstrapTokenTtlSeconds) || bootstrapTokenTtlSeconds <= 0) {
    throw new Error("Expected tunnel bootstrap token TTL seconds to be a positive number.");
  }

  return {
    timeoutMs: bootstrapTokenTtlSeconds * 1000,
    pollIntervalMs: SandboxTunnelConnectAckPollIntervalMs,
  };
}

async function createDataPlaneWorkflowRuntime(): Promise<DataPlaneWorkflowRuntime> {
  const { appConfig, globalConfig } = getDataPlaneWorkerConfig();
  const dbPool = new Pool({
    connectionString: appConfig.database.url,
  });
  const db = createDataPlaneDatabase(dbPool);

  try {
    const workflowBackend = await createDataPlaneBackend({
      url: appConfig.workflow.databaseUrl,
      namespaceId: appConfig.workflow.namespaceId,
      runMigrations: appConfig.workflow.runMigrations,
    });

    return {
      config: {
        app: appConfig,
        sandbox: globalConfig.sandbox,
        telemetry: globalConfig.telemetry,
      },
      db,
      dbPool,
      sandboxAdapter: createSandboxRuntimeAdapter({
        app: appConfig,
        sandbox: globalConfig.sandbox,
        telemetry: globalConfig.telemetry,
      }),
      tunnelConnectAckPolicy: createTunnelConnectAckPolicy({
        app: appConfig,
        sandbox: globalConfig.sandbox,
        telemetry: globalConfig.telemetry,
      }),
      workflowBackend,
    };
  } catch (error) {
    await dbPool.end();
    throw error;
  }
}

export function getDataPlaneWorkflowRuntime(): Promise<DataPlaneWorkflowRuntime> {
  workflowRuntimePromise ??= createDataPlaneWorkflowRuntime();
  return workflowRuntimePromise;
}

export async function getDataPlaneWorkflowBackend(): Promise<BackendPostgres> {
  const runtime = await getDataPlaneWorkflowRuntime();
  return runtime.workflowBackend;
}
