import {
  SandboxInstancePersistenceModes,
  type SandboxInstancePersistenceMode,
} from "@mistle/db/data-plane";
import {
  SandboxStorageAttachLifecycles,
  type SandboxAdapter,
  type SandboxProvider,
} from "@mistle/sandbox";

export async function attachSandboxStorage(
  ctx: {
    configuredSandboxProvider: SandboxProvider;
    sandboxAdapter: SandboxAdapter;
  },
  input: {
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

  await ctx.sandboxAdapter.attachStorage({
    sandboxInstanceId: input.sandboxInstanceId,
    sandbox: {
      provider: input.runtimeProvider,
      id: input.providerSandboxId,
    },
    lifecycle:
      input.lifecycle === "start"
        ? SandboxStorageAttachLifecycles.START
        : SandboxStorageAttachLifecycles.RESUME,
  });
}
