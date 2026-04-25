import type {
  SandboxAdapter,
  SandboxProvider,
  SandboxStartStoragePreparation,
} from "@mistle/sandbox";
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
    storagePreparation?: SandboxStartStoragePreparation;
  },
): Promise<{
  sandboxInstanceId: string;
  runtimeProvider: SandboxProvider;
  providerSandboxId: string;
}> {
  const imageProvider =
    input.image.kind === "snapshot"
      ? (input.image.provider ??
        (() => {
          throw new Error("Snapshot launch image is missing its provider.");
        })())
      : ctx.config.sandbox.provider;

  const startedSandbox = await ctx.sandboxAdapter.start({
    image: {
      ...input.image,
      provider: imageProvider,
      createdAt: input.image.createdAt ?? new Date().toISOString(),
    },
    env: createSandboxRuntimeEnv({
      config: ctx.config,
      sandboxInstanceId: input.sandboxInstanceId,
    }),
    ...(input.storagePreparation === undefined
      ? {}
      : { storagePreparation: input.storagePreparation }),
  });

  if (startedSandbox.provider !== imageProvider) {
    throw new Error("Sandbox adapter returned sandbox handle with unexpected provider.");
  }

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    runtimeProvider: startedSandbox.provider,
    providerSandboxId: startedSandbox.id,
  };
}
