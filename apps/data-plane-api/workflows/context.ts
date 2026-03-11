import { AppIds, loadConfig } from "@mistle/config";
import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import { createSandboxAdapter, SandboxProvider, type SandboxAdapter } from "@mistle/sandbox";
import { systemClock, systemSleeper, type Clock, type Sleeper } from "@mistle/time";
import { Pool } from "pg";

type LoadDataPlaneWorkerConfigResult = ReturnType<
  typeof loadConfig<typeof AppIds.DATA_PLANE_WORKER>
>;

type DataPlaneWorkerConfig = LoadDataPlaneWorkerConfigResult["app"];
type DataPlaneWorkerGlobalConfig = NonNullable<LoadDataPlaneWorkerConfigResult["global"]>;

export type TunnelConnectAckPolicy = {
  timeoutMs: number;
  pollIntervalMs: number;
};

export type DataPlaneWorkflowRuntimeConfig = {
  app: DataPlaneWorkerConfig;
  sandbox: DataPlaneWorkerGlobalConfig["sandbox"];
  telemetry: DataPlaneWorkerGlobalConfig["telemetry"];
};

export type WorkflowContext = {
  db: DataPlaneDatabase;
  runtimeConfig: DataPlaneWorkflowRuntimeConfig;
  sandboxAdapter: SandboxAdapter;
  tunnelConnectAckPolicy: TunnelConnectAckPolicy;
  clock: Clock;
  sleeper: Sleeper;
};

const SandboxTunnelConnectAckPollIntervalMs = 250;

let workflowContextPromise: Promise<WorkflowContext> | undefined;

function assertUnreachable(_value: never): never {
  throw new Error("Unsupported sandbox provider.");
}

function createSandboxRuntimeAdapter(config: DataPlaneWorkflowRuntimeConfig): SandboxAdapter {
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

  if (config.sandbox.provider === SandboxProvider.DOCKER) {
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

function resolveSandboxTunnelConnectAckTimeoutMs(config: DataPlaneWorkflowRuntimeConfig): number {
  const bootstrapTokenTtlSeconds = config.app.tunnel.bootstrapTokenTtlSeconds;

  if (!Number.isFinite(bootstrapTokenTtlSeconds) || bootstrapTokenTtlSeconds <= 0) {
    throw new Error("Expected tunnel bootstrap token TTL seconds to be a positive number.");
  }

  return bootstrapTokenTtlSeconds * 1000;
}

export function getWorkflowContext(): Promise<WorkflowContext> {
  if (workflowContextPromise !== undefined) {
    return workflowContextPromise;
  }

  workflowContextPromise = Promise.resolve().then(() => {
    const apiConfig = loadConfig({
      app: AppIds.DATA_PLANE_API,
      env: process.env,
      includeGlobal: false,
    });
    const workerConfig = loadConfig({
      app: AppIds.DATA_PLANE_WORKER,
      env: process.env,
    });
    const dbPool = new Pool({
      connectionString: apiConfig.app.database.url,
    });
    const globalConfig = workerConfig.global;

    if (globalConfig === undefined) {
      throw new Error("Expected data-plane worker global config for workflow context.");
    }

    const runtimeConfig: DataPlaneWorkflowRuntimeConfig = {
      app: workerConfig.app,
      sandbox: globalConfig.sandbox,
      telemetry: globalConfig.telemetry,
    };

    return {
      db: createDataPlaneDatabase(dbPool),
      runtimeConfig,
      sandboxAdapter: createSandboxRuntimeAdapter(runtimeConfig),
      tunnelConnectAckPolicy: {
        timeoutMs: resolveSandboxTunnelConnectAckTimeoutMs(runtimeConfig),
        pollIntervalMs: SandboxTunnelConnectAckPollIntervalMs,
      },
      clock: systemClock,
      sleeper: systemSleeper,
    };
  });

  return workflowContextPromise;
}
