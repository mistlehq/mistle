import type {
  SandboxAdapter,
  SandboxProvider,
  SandboxStartStoragePreparation,
} from "@mistle/sandbox";
import type { StartSandboxInstanceWorkflowImageInput } from "@mistle/workflow-registry/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";

const SandboxRuntimeSandboxInstanceIDEnv = "SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID";
const SandboxdTestFaultsEnabledEnv = "MISTLE_SANDBOXD_ENABLE_TEST_FAULTS";
export const SandboxdWaitForStorageAttachEnv = "MISTLE_SANDBOXD_WAIT_FOR_STORAGE_ATTACH";

export function createSandboxRuntimeEnv(input: {
  config: DataPlaneWorkerRuntimeConfig;
  sandboxInstanceId: string;
  waitForStorageAttach?: boolean;
}): Record<string, string> {
  return {
    [SandboxRuntimeSandboxInstanceIDEnv]: input.sandboxInstanceId,
    ...(input.waitForStorageAttach === true ? { [SandboxdWaitForStorageAttachEnv]: "1" } : {}),
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
    processEnv: Readonly<Record<string, string | undefined>>;
    sandboxAdapter: SandboxAdapter;
  },
  input: {
    sandboxInstanceId: string;
    image: StartSandboxInstanceWorkflowImageInput;
    runtimeProvider: SandboxProvider;
    storagePreparation?: SandboxStartStoragePreparation;
  },
): Promise<{
  sandboxInstanceId: string;
  runtimeProvider: SandboxProvider;
  providerSandboxId: string;
}> {
  if (input.image.provider !== input.runtimeProvider) {
    throw new Error("Sandbox launch image provider does not match runtime provider.");
  }

  const startedSandbox = await ctx.sandboxAdapter.start({
    image: {
      ...input.image,
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

  if (startedSandbox.provider !== input.runtimeProvider) {
    throw new Error("Sandbox adapter returned sandbox handle with unexpected provider.");
  }

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    runtimeProvider: startedSandbox.provider,
    providerSandboxId: startedSandbox.id,
  };
}
