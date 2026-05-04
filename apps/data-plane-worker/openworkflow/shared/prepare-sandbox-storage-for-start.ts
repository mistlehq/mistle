import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  SandboxInstancePersistenceModes,
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstancePersistenceMode,
} from "@mistle/db/data-plane";
import {
  type SandboxAdapter,
  type SandboxImageHandle,
  type SandboxProvider,
  SandboxProvider as SandboxProviderIds,
  type SandboxStorageBackend,
  type SandboxStartStoragePreparation,
} from "@mistle/sandbox";
import type { StartSandboxInstanceWorkflowImageInput } from "@mistle/workflow-registry/data-plane";

import type { DataPlaneWorkerConfig } from "../core/config.js";
import { createSandboxStorageBackendAdapter } from "./sandbox-storage/create-sandbox-storage-backend-adapter.js";

function toSandboxImageHandle(input: {
  image: StartSandboxInstanceWorkflowImageInput;
  provider: SandboxProvider;
}): SandboxImageHandle {
  return {
    provider: input.provider,
    imageId: input.image.imageId,
    createdAt: input.image.createdAt ?? new Date().toISOString(),
  };
}

export async function prepareSandboxStorageForStart(
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
    image: StartSandboxInstanceWorkflowImageInput;
    persistenceMode: SandboxInstancePersistenceMode;
    runtimeProvider: SandboxProvider;
  },
): Promise<SandboxStartStoragePreparation> {
  if (input.persistenceMode === SandboxInstancePersistenceModes.EPHEMERAL) {
    return {};
  }

  if (input.runtimeProvider !== ctx.configuredSandboxProvider) {
    throw new Error(
      "Attempted to prepare sandbox storage for start using provider different from configured runtime sandbox provider.",
    );
  }

  if (input.runtimeProvider !== SandboxProviderIds.DOCKER) {
    return ctx.sandboxAdapter.prepareStorageForStart({
      sandboxInstanceId: input.sandboxInstanceId,
      image: toSandboxImageHandle({
        image: input.image,
        provider: input.runtimeProvider,
      }),
    });
  }

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

  return ctx.sandboxAdapter.prepareStorageForStart({
    sandboxInstanceId: input.sandboxInstanceId,
    image: toSandboxImageHandle({
      image: input.image,
      provider: input.runtimeProvider,
    }),
    storage: resolvedStorage,
  });
}
