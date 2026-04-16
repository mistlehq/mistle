import {
  SandboxInstancePersistenceModes,
  type DataPlaneDatabase,
  type SandboxInstancePersistenceMode,
} from "@mistle/db/data-plane";
import {
  SandboxAttachedStorageBackends,
  SandboxStorageCleanupLifecycles,
  SandboxStorageCleanupTimings,
  type SandboxAdapter,
  type SandboxProvider,
} from "@mistle/sandbox";

import { requireReadyArchilSandboxStorage } from "../start-sandbox-instance/provision-sandbox-storage.js";

export async function cleanupSandboxStorage(
  ctx: {
    db: DataPlaneDatabase;
    configuredSandboxProvider: SandboxProvider;
    sandboxAdapter: SandboxAdapter;
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

  const storage = requireReadyArchilSandboxStorage({
    sandboxInstanceId: input.sandboxInstanceId,
    storage: await ctx.db.query.sandboxInstanceStorages.findFirst({
      where: (table, { eq }) => eq(table.sandboxInstanceId, input.sandboxInstanceId),
    }),
  });

  await ctx.sandboxAdapter.cleanupStorage({
    sandboxInstanceId: input.sandboxInstanceId,
    sandbox: {
      provider: input.runtimeProvider,
      id: input.providerSandboxId,
    },
    storage: {
      backend: SandboxAttachedStorageBackends.ARCHIL,
      handle: storage.handle,
      region: storage.region,
    },
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
