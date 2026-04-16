import {
  SandboxInstancePersistenceModes,
  type SandboxInstancePersistenceMode,
} from "@mistle/db/data-plane";
import {
  SandboxStorageCleanupLifecycles,
  SandboxStorageCleanupTimings,
  type SandboxAdapter,
  type SandboxProvider,
} from "@mistle/sandbox";

export async function cleanupSandboxStorage(
  ctx: {
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

  await ctx.sandboxAdapter.cleanupStorage({
    sandboxInstanceId: input.sandboxInstanceId,
    sandbox: {
      provider: input.runtimeProvider,
      id: input.providerSandboxId,
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
