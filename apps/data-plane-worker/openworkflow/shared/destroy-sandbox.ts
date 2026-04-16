import type { SandboxInstancePersistenceMode } from "@mistle/db/data-plane";
import type { SandboxAdapter, SandboxProvider } from "@mistle/sandbox";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { cleanupSandboxStorage } from "./cleanup-sandbox-storage.js";
import { throwSandboxTeardownOutcome } from "./teardown-outcome.js";

export async function destroySandbox(
  ctx: {
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
      "Attempted to destroy sandbox using provider different from configured runtime sandbox provider.",
    );
  }

  await cleanupSandboxStorage(
    {
      configuredSandboxProvider: ctx.config.sandbox.provider,
      sandboxAdapter: ctx.sandboxAdapter,
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

  let destroyError: unknown;
  try {
    await ctx.sandboxAdapter.destroy({
      id: input.providerSandboxId,
    });
  } catch (error) {
    destroyError = error;
  }

  let storageCleanupError: unknown;
  try {
    await cleanupSandboxStorage(
      {
        configuredSandboxProvider: ctx.config.sandbox.provider,
        sandboxAdapter: ctx.sandboxAdapter,
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
    storageCleanupError = error;
  }

  throwSandboxTeardownOutcome({
    lifecycle: "destroy",
    computeTeardownError: destroyError,
    storageCleanupError,
  });
}
