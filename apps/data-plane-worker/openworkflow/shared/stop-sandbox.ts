import type { SandboxInstancePersistenceMode } from "@mistle/db/data-plane";
import type { SandboxAdapter, SandboxProvider } from "@mistle/sandbox";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { cleanupSandboxStorage } from "./cleanup-sandbox-storage.js";
import { throwSandboxTeardownOutcome } from "./teardown-outcome.js";

export async function stopSandbox(
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
      "Attempted to stop sandbox using provider different from configured runtime sandbox provider.",
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
      lifecycle: "stop",
      timing: "before_compute_teardown",
    },
  );

  let stopError: unknown;
  try {
    await ctx.sandboxAdapter.stop({
      id: input.providerSandboxId,
    });
  } catch (error) {
    stopError = error;
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
        lifecycle: "stop",
        timing: "after_compute_teardown",
      },
    );
  } catch (error) {
    storageCleanupError = error;
  }

  throwSandboxTeardownOutcome({
    lifecycle: "stop",
    computeTeardownError: stopError,
    storageCleanupError,
  });
}
