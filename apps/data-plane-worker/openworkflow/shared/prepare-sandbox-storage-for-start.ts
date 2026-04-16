import {
  SandboxInstancePersistenceModes,
  type SandboxInstancePersistenceMode,
} from "@mistle/db/data-plane";
import {
  type SandboxAdapter,
  type SandboxProvider,
  type SandboxStartStoragePreparation,
} from "@mistle/sandbox";

export async function prepareSandboxStorageForStart(
  ctx: {
    configuredSandboxProvider: SandboxProvider;
    sandboxAdapter: SandboxAdapter;
  },
  input: {
    sandboxInstanceId: string;
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

  return ctx.sandboxAdapter.prepareStorageForStart({
    sandboxInstanceId: input.sandboxInstanceId,
  });
}
