import type { SandboxAdapter, SandboxProvider } from "@mistle/sandbox";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";

export async function stopSandbox(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    sandboxAdapter: SandboxAdapter;
  },
  input: {
    runtimeProvider: SandboxProvider;
    providerRuntimeId: string;
  },
): Promise<void> {
  if (input.runtimeProvider !== ctx.config.sandbox.provider) {
    throw new Error(
      "Attempted to stop sandbox using provider different from configured runtime sandbox provider.",
    );
  }

  await ctx.sandboxAdapter.stop({
    id: input.providerRuntimeId,
  });
}
