import type { SandboxAdapter, SandboxProvider } from "@mistle/sandbox";
import type { StartSandboxInstanceWorkflowImageInput } from "@mistle/workflow-registry/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";

const SandboxRuntimeTokenizerProxyEgressBaseURLEnv =
  "SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL";
const SandboxRuntimeSandboxInstanceIDEnv = "SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID";
const SandboxdTestFaultsEnabledEnv = "MISTLE_SANDBOXD_ENABLE_TEST_FAULTS";

export function createSandboxRuntimeEnv(input: {
  config: DataPlaneWorkerRuntimeConfig;
  sandboxInstanceId: string;
}): Record<string, string> {
  return {
    [SandboxRuntimeTokenizerProxyEgressBaseURLEnv]:
      input.config.app.sandbox.tokenizerProxyEgressBaseUrl,
    [SandboxRuntimeSandboxInstanceIDEnv]: input.sandboxInstanceId,
    ...(input.config.app.sandbox.sandboxdTestFaultsEnabled === true
      ? {
          [SandboxdTestFaultsEnabledEnv]: "1",
        }
      : {}),
  };
}

export async function startSandbox(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    sandboxAdapter: SandboxAdapter;
  },
  input: {
    sandboxInstanceId: string;
    image: StartSandboxInstanceWorkflowImageInput;
  },
): Promise<{
  sandboxInstanceId: string;
  runtimeProvider: SandboxProvider;
  providerSandboxId: string;
}> {
  const startedSandbox = await ctx.sandboxAdapter.start({
    image: {
      ...input.image,
      provider: ctx.config.sandbox.provider,
    },
    env: createSandboxRuntimeEnv({
      config: ctx.config,
      sandboxInstanceId: input.sandboxInstanceId,
    }),
  });

  if (startedSandbox.provider !== ctx.config.sandbox.provider) {
    throw new Error("Sandbox adapter returned sandbox handle with unexpected provider.");
  }

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    runtimeProvider: startedSandbox.provider,
    providerSandboxId: startedSandbox.id,
  };
}
