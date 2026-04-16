import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  SandboxInstancePersistenceModes,
  type DataPlaneDatabase,
  type SandboxInstancePersistenceMode,
} from "@mistle/db/data-plane";
import {
  SandboxStorageCleanupLifecycles,
  SandboxStorageCleanupTimings,
  type SandboxAdapter,
  type SandboxProvider,
  type SandboxStorageBackend,
} from "@mistle/sandbox";

import type { DataPlaneWorkerConfig } from "../core/config.js";
import { createSandboxStorageBackendAdapter } from "./sandbox-storage/create-sandbox-storage-backend-adapter.js";

export async function cleanupSandboxStorage(
  ctx: {
    db: DataPlaneDatabase;
    controlPlaneInternalClient: ControlPlaneInternalClient;
    workerConfig: DataPlaneWorkerConfig;
    configuredSandboxProvider: SandboxProvider;
    sandboxAdapter: SandboxAdapter;
    storageBackend: SandboxStorageBackend | undefined;
  },
  input: {
    sandboxInstanceId: string;
    persistenceMode: SandboxInstancePersistenceMode;
    runtimeProvider: SandboxProvider;
    providerSandboxId: string;
    lifecycle: "stop" | "destroy";
    timing: "before_compute_teardown" | "after_compute_teardown";
  },
): Promise<void> {
  if (input.persistenceMode === SandboxInstancePersistenceModes.EPHEMERAL) {
    return;
  }

  if (input.runtimeProvider !== ctx.configuredSandboxProvider) {
    throw new Error(
      "Attempted to clean up sandbox storage using provider different from configured runtime sandbox provider.",
    );
  }

  const storageBackendAdapter = createSandboxStorageBackendAdapter({
    db: ctx.db,
    controlPlaneInternalClient: ctx.controlPlaneInternalClient,
    workerConfig: ctx.workerConfig,
    runtimeProvider: input.runtimeProvider,
    storageBackend: ctx.storageBackend,
  });

  const storage = await storageBackendAdapter.resolveCleanup({
    sandboxInstanceId: input.sandboxInstanceId,
  });

  await ctx.sandboxAdapter.cleanupStorage({
    sandboxInstanceId: input.sandboxInstanceId,
    sandbox: {
      provider: input.runtimeProvider,
      id: input.providerSandboxId,
    },
    storage,
    lifecycle:
      input.lifecycle === "stop"
        ? SandboxStorageCleanupLifecycles.STOP
        : SandboxStorageCleanupLifecycles.DESTROY,
    timing:
      input.timing === "before_compute_teardown"
        ? SandboxStorageCleanupTimings.BEFORE_COMPUTE_TEARDOWN
        : SandboxStorageCleanupTimings.AFTER_COMPUTE_TEARDOWN,
  });
}
