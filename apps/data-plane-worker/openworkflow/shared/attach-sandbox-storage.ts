import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  SandboxInstancePersistenceModes,
  type DataPlaneDatabase,
  type SandboxInstancePersistenceMode,
} from "@mistle/db/data-plane";
import { SandboxAttachedStorageBackends } from "@mistle/sandbox";
import {
  SandboxStorageAttachLifecycles,
  type SandboxAdapter,
  type SandboxProvider,
} from "@mistle/sandbox";

import { resolveReadyArchilSandboxStorage } from "../start-sandbox-instance/provision-sandbox-storage.js";

export async function attachSandboxStorage(
  ctx: {
    db: DataPlaneDatabase;
    controlPlaneInternalClient: ControlPlaneInternalClient;
    configuredSandboxProvider: SandboxProvider;
    sandboxAdapter: SandboxAdapter;
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

  const resolvedStorage = await resolveReadyArchilSandboxStorage({
    db: ctx.db,
    controlPlaneInternalClient: ctx.controlPlaneInternalClient,
    organizationId: input.organizationId,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  await ctx.sandboxAdapter.attachStorage({
    sandboxInstanceId: input.sandboxInstanceId,
    sandbox: {
      provider: input.runtimeProvider,
      id: input.providerSandboxId,
    },
    storage: {
      backend: SandboxAttachedStorageBackends.ARCHIL,
      handle: resolvedStorage.storage.handle,
      region: resolvedStorage.storage.region,
      credential: resolvedStorage.diskToken,
    },
    lifecycle:
      input.lifecycle === "start"
        ? SandboxStorageAttachLifecycles.START
        : SandboxStorageAttachLifecycles.RESUME,
  });
}
