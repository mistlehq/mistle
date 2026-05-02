import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import type {
  DataPlaneDatabase,
  DataPlaneTables,
  SandboxInstancePersistenceMode,
} from "@mistle/db/data-plane";
import type { SandboxAdapter, SandboxProvider } from "@mistle/sandbox";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { cleanupSandboxStorage } from "./cleanup-sandbox-storage.js";
import {
  combineSandboxStorageCleanupErrors,
  throwSandboxTeardownOutcome,
} from "./teardown-outcome.js";

export async function stopSandbox(
  ctx: {
    db: DataPlaneDatabase;
    tables: Pick<DataPlaneTables, "sandboxInstanceStorages" | "sandboxInstances">;
    controlPlaneInternalClient: ControlPlaneInternalClient;
    config: DataPlaneWorkerRuntimeConfig;
    sandboxAdapter: SandboxAdapter;
  },
  input: {
    sandboxInstanceId: string;
    persistenceMode: SandboxInstancePersistenceMode;
    runtimeProvider: SandboxProvider;
    providerSandboxId: string;
  },
): Promise<void> {
  if (input.runtimeProvider !== ctx.config.sandbox.provider) {
    throw new Error(
      "Attempted to stop sandbox using provider different from configured runtime sandbox provider.",
    );
  }

  let beforeComputeStorageCleanupError: unknown;
  try {
    await cleanupSandboxStorage(
      {
        db: ctx.db,
        tables: ctx.tables,
        controlPlaneInternalClient: ctx.controlPlaneInternalClient,
        workerConfig: ctx.config.app,
        configuredSandboxProvider: ctx.config.sandbox.provider,
        sandboxAdapter: ctx.sandboxAdapter,
        storageBackend: ctx.config.sandbox.storage?.backend,
      },
      {
        sandboxInstanceId: input.sandboxInstanceId,
        persistenceMode: input.persistenceMode,
        runtimeProvider: input.runtimeProvider,
        providerSandboxId: input.providerSandboxId,
        lifecycle: "stop",
        timing: "before_compute_teardown",
      },
    );
  } catch (error) {
    beforeComputeStorageCleanupError = error;
  }

  let stopError: unknown;
  try {
    await ctx.sandboxAdapter.stop({
      id: input.providerSandboxId,
    });
  } catch (error) {
    stopError = error;
  }

  let afterComputeStorageCleanupError: unknown;
  try {
    await cleanupSandboxStorage(
      {
        db: ctx.db,
        tables: ctx.tables,
        controlPlaneInternalClient: ctx.controlPlaneInternalClient,
        workerConfig: ctx.config.app,
        configuredSandboxProvider: ctx.config.sandbox.provider,
        sandboxAdapter: ctx.sandboxAdapter,
        storageBackend: ctx.config.sandbox.storage?.backend,
      },
      {
        sandboxInstanceId: input.sandboxInstanceId,
        persistenceMode: input.persistenceMode,
        runtimeProvider: input.runtimeProvider,
        providerSandboxId: input.providerSandboxId,
        lifecycle: "stop",
        timing: "after_compute_teardown",
      },
    );
  } catch (error) {
    afterComputeStorageCleanupError = error;
  }

  throwSandboxTeardownOutcome({
    lifecycle: "stop",
    computeTeardownError: stopError,
    storageCleanupError: combineSandboxStorageCleanupErrors({
      lifecycle: "stop",
      beforeComputeTeardownError: beforeComputeStorageCleanupError,
      afterComputeTeardownError: afterComputeStorageCleanupError,
    }),
  });
}
