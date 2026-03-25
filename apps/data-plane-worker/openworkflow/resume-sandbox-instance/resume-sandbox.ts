import type { SandboxAdapter, SandboxProvider } from "@mistle/sandbox";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { createSandboxRuntimeEnv } from "../start-sandbox-instance/start-sandbox.js";

export async function resumeSandbox(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    sandboxAdapter: SandboxAdapter;
  },
  input: {
    sandboxInstanceId: string;
    providerSandboxId: string;
  },
): Promise<{
  sandboxInstanceId: string;
  runtimeProvider: SandboxProvider;
  providerSandboxId: string;
}> {
  const resumedSandbox = await ctx.sandboxAdapter.resume({
    id: input.providerSandboxId,
    env: createSandboxRuntimeEnv({
      config: ctx.config,
      sandboxInstanceId: input.sandboxInstanceId,
    }),
  });

  if (resumedSandbox.provider !== ctx.config.sandbox.provider) {
    throw new Error("Sandbox adapter returned sandbox handle with unexpected provider.");
  }
  if (resumedSandbox.id !== input.providerSandboxId) {
    throw new Error("Sandbox adapter returned a different sandbox id during resume.");
  }

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    runtimeProvider: resumedSandbox.provider,
    providerSandboxId: resumedSandbox.id,
  };
}
