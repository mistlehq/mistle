import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  SandboxInstancePersistenceModes,
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstancePersistenceMode,
} from "@mistle/db/data-plane";
import {
  SandboxStorageAttachLifecycles,
  type SandboxAdapter,
  type SandboxProvider,
  type SandboxStorageBackend,
} from "@mistle/sandbox";

import type { DataPlaneWorkerConfig } from "../core/config.js";
import { createSandboxStorageBackendAdapter } from "./sandbox-storage/create-sandbox-storage-backend-adapter.js";
import { withSandboxStorageTelemetry } from "./sandbox-storage/telemetry.js";

export async function attachSandboxStorage(
  ctx: {
    db: DataPlaneDatabase;
    tables: Pick<DataPlaneTables, "sandboxInstanceStorages" | "sandboxInstances">;
    controlPlaneInternalClient: ControlPlaneInternalClient;
    workerConfig: DataPlaneWorkerConfig;
    configuredSandboxProvider: SandboxProvider;
    sandboxAdapter: SandboxAdapter;
    storageBackend: SandboxStorageBackend | undefined;
  },
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    persistenceMode: SandboxInstancePersistenceMode;
    runtimeProvider: SandboxProvider;
    providerSandboxId: string;
    lifecycle: "start" | "resume";
  },
): Promise<void> {
  if (input.persistenceMode === SandboxInstancePersistenceModes.EPHEMERAL) {
    return;
  }

  if (input.runtimeProvider !== ctx.configuredSandboxProvider) {
    throw new Error(
      "Attempted to attach sandbox storage using provider different from configured runtime sandbox provider.",
    );
  }

  await withSandboxStorageTelemetry({
    operation: "attach",
    telemetry: {
      sandboxInstanceId: input.sandboxInstanceId,
      organizationId: input.organizationId,
      persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
      runtimeProvider: input.runtimeProvider,
      operation: "attach",
      ...(ctx.storageBackend === undefined
        ? {}
        : {
            storageBackend: ctx.storageBackend,
          }),
    },
    providerOperation: `${input.runtimeProvider}.attach_storage`,
    fn: async () => {
      const storageBackendAdapter = createSandboxStorageBackendAdapter({
        db: ctx.db,
        tables: ctx.tables,
        controlPlaneInternalClient: ctx.controlPlaneInternalClient,
        workerConfig: ctx.workerConfig,
        runtimeProvider: input.runtimeProvider,
        storageBackend: ctx.storageBackend,
      });

      const resolvedStorage = await storageBackendAdapter.resolveAttachment({
        organizationId: input.organizationId,
        sandboxInstanceId: input.sandboxInstanceId,
      });

      await ctx.sandboxAdapter.attachStorage({
        sandboxInstanceId: input.sandboxInstanceId,
        sandbox: {
          provider: input.runtimeProvider,
          id: input.providerSandboxId,
        },
        storage: resolvedStorage,
        lifecycle:
          input.lifecycle === "start"
            ? SandboxStorageAttachLifecycles.START
            : SandboxStorageAttachLifecycles.RESUME,
      });
    },
  });
}
