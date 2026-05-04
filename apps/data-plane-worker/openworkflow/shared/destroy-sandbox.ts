import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import type {
  DataPlaneDatabase,
  DataPlaneTables,
  SandboxInstancePersistenceMode,
} from "@mistle/db/data-plane";
import type { SandboxAdapter, SandboxProvider } from "@mistle/sandbox";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { cleanupSandboxStorage } from "./cleanup-sandbox-storage.js";
import { createSandboxStorageBackendAdapter } from "./sandbox-storage/create-sandbox-storage-backend-adapter.js";
import {
  combineSandboxStorageCleanupErrors,
  throwSandboxTeardownOutcome,
} from "./teardown-outcome.js";

export async function destroySandbox(
  ctx: {
    db: DataPlaneDatabase;
    tables: Pick<DataPlaneTables, "sandboxInstanceStorages" | "sandboxInstances">;
    controlPlaneInternalClient: ControlPlaneInternalClient;
    config: DataPlaneWorkerRuntimeConfig;
    sandboxAdapter: SandboxAdapter;
  },
  input: {
    sandboxInstanceId: string;
    organizationId: string;
    persistenceMode: SandboxInstancePersistenceMode;
    runtimeProvider: SandboxProvider;
    providerSandboxId: string;
    skipPersistentStorageDeprovision?: boolean;
  },
): Promise<void> {
  if (input.runtimeProvider !== ctx.config.sandbox.provider) {
    throw new Error(
      "Attempted to destroy sandbox using provider different from configured runtime sandbox provider.",
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
        lifecycle: "destroy",
        timing: "before_compute_teardown",
      },
    );
  } catch (error) {
    beforeComputeStorageCleanupError = error;
  }

  let destroyError: unknown;
  try {
    await ctx.sandboxAdapter.destroy({
      id: input.providerSandboxId,
    });
  } catch (error) {
    destroyError = error;
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
        lifecycle: "destroy",
        timing: "after_compute_teardown",
      },
    );
  } catch (error) {
    afterComputeStorageCleanupError = error;
  }

  let deprovisionSandboxStorageError: unknown;
  if (
    input.persistenceMode === "persistent" &&
    input.skipPersistentStorageDeprovision !== true &&
    destroyError === undefined
  ) {
    try {
      const storageBackendAdapter = createSandboxStorageBackendAdapter({
        db: ctx.db,
        tables: ctx.tables,
        controlPlaneInternalClient: ctx.controlPlaneInternalClient,
        workerConfig: ctx.config.app,
        runtimeProvider: input.runtimeProvider,
        storageBackend: ctx.config.sandbox.storage?.backend,
      });

      await storageBackendAdapter.deprovision({
        organizationId: input.organizationId,
        sandboxInstanceId: input.sandboxInstanceId,
      });
    } catch (error) {
      deprovisionSandboxStorageError = error;
    }
  }

  const baseStorageCleanupError = combineSandboxStorageCleanupErrors({
    lifecycle: "destroy",
    beforeComputeTeardownError: beforeComputeStorageCleanupError,
    afterComputeTeardownError: afterComputeStorageCleanupError,
  });

  const combinedStorageCleanupError =
    baseStorageCleanupError !== undefined && deprovisionSandboxStorageError !== undefined
      ? new Error("Failed to clean up and deprovision sandbox storage during destroy.", {
          cause: {
            storageCleanupError: baseStorageCleanupError,
            deprovisionSandboxStorageError,
          },
        })
      : (baseStorageCleanupError ?? deprovisionSandboxStorageError);

  throwSandboxTeardownOutcome({
    lifecycle: "destroy",
    computeTeardownError: destroyError,
    storageCleanupError: combinedStorageCleanupError,
  });
}
