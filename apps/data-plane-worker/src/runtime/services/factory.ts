import type { DataPlaneWorkerRuntimeConfig } from "../../types.js";
import {
  ensureSandboxInstance,
  persistSandboxInstanceProvisioning,
} from "./insert-sandbox-instance.js";
import { startSandbox } from "./start-sandbox.js";
import { stopSandbox } from "./stop-sandbox.js";
import type {
  CreateDataPlaneWorkerServicesInput,
  DataPlaneWorkerServices,
  TunnelReadinessPolicy,
} from "./types.js";
import {
  markSandboxInstanceFailed,
  markSandboxInstanceRunning,
} from "./update-sandbox-instance-status.js";
import { waitForSandboxTunnelReadiness } from "./wait-for-sandbox-tunnel-readiness.js";

const SandboxTunnelReadinessPollIntervalMs = 250;

function resolveSandboxTunnelReadinessTimeoutMs(config: DataPlaneWorkerRuntimeConfig): number {
  const bootstrapTokenTtlSeconds = config.app.tunnel.bootstrapTokenTtlSeconds;

  if (!Number.isFinite(bootstrapTokenTtlSeconds) || bootstrapTokenTtlSeconds <= 0) {
    throw new Error("Expected tunnel bootstrap token TTL seconds to be a positive number.");
  }

  return bootstrapTokenTtlSeconds * 1000;
}

export function createDefaultTunnelReadinessPolicy(
  config: DataPlaneWorkerRuntimeConfig,
): TunnelReadinessPolicy {
  return {
    timeoutMs: resolveSandboxTunnelReadinessTimeoutMs(config),
    pollIntervalMs: SandboxTunnelReadinessPollIntervalMs,
  };
}

export function createDataPlaneWorkerServices(
  input: CreateDataPlaneWorkerServicesInput,
): DataPlaneWorkerServices {
  return {
    startSandboxInstance: {
      sandboxLifecycle: {
        startSandbox: async (workflowInput) => {
          return startSandbox(
            {
              config: input.config,
              sandboxAdapter: input.sandboxAdapter,
            },
            workflowInput,
          );
        },
        stopSandbox: async (workflowInput) => {
          await stopSandbox(
            {
              config: input.config,
              sandboxAdapter: input.sandboxAdapter,
            },
            workflowInput,
          );
        },
      },
      sandboxInstances: {
        ensureSandboxInstance: async (workflowInput) => {
          return ensureSandboxInstance(
            {
              db: input.db,
              provider: input.config.sandbox.provider,
            },
            workflowInput,
          );
        },
        persistSandboxInstanceProvisioning: async (workflowInput) => {
          await persistSandboxInstanceProvisioning(
            {
              db: input.db,
            },
            workflowInput,
          );
        },
        markSandboxInstanceRunning: async (workflowInput) => {
          await markSandboxInstanceRunning(
            {
              db: input.db,
            },
            workflowInput,
          );
        },
        markSandboxInstanceFailed: async (workflowInput) => {
          await markSandboxInstanceFailed(
            {
              db: input.db,
            },
            workflowInput,
          );
        },
      },
      tunnelReadiness: {
        waitForSandboxTunnelReadiness: async (workflowInput) => {
          return waitForSandboxTunnelReadiness(
            {
              db: input.db,
              policy: input.tunnelReadinessPolicy,
              clock: input.clock,
              sleeper: input.sleeper,
            },
            workflowInput,
          );
        },
      },
    },
  } satisfies DataPlaneWorkerServices;
}
