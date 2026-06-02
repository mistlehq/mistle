import type { SandboxAdapter, SandboxImageHandle, SandboxProvider } from "@mistle/sandbox";
import type {
  StartSandboxInstanceWorkflowImageInput,
  SandboxRuntimeResourceInput,
} from "@mistle/workflow-registry/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";

const SandboxRuntimeSandboxInstanceIDEnv = "SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID";
const SandboxdTestFaultsEnabledEnv = "MISTLE_SANDBOXD_ENABLE_TEST_FAULTS";

export function createSandboxRuntimeEnv(input: {
  config: DataPlaneWorkerRuntimeConfig;
  sandboxInstanceId: string;
}): Record<string, string> {
  return {
    [SandboxRuntimeSandboxInstanceIDEnv]: input.sandboxInstanceId,
    ...(input.config.app.sandbox.sandboxdTestFaultsEnabled === true
      ? {
          [SandboxdTestFaultsEnabledEnv]: "1",
        }
      : {}),
  };
}

function toSandboxImageHandle(input: {
  image: StartSandboxInstanceWorkflowImageInput;
  provider: SandboxProvider;
}): SandboxImageHandle {
  return {
    provider: input.provider,
    imageId: input.image.imageId,
    createdAt: input.image.createdAt ?? new Date().toISOString(),
  };
}

export async function prepareSandboxImage(
  ctx: {
    sandboxAdapter: SandboxAdapter;
  },
  input: {
    image: StartSandboxInstanceWorkflowImageInput;
    runtimeProvider: SandboxProvider;
  },
): Promise<StartSandboxInstanceWorkflowImageInput> {
  if (input.image.provider !== input.runtimeProvider) {
    throw new Error("Sandbox launch image provider does not match runtime provider.");
  }

  const preparedImage = await ctx.sandboxAdapter.prepareImage({
    image: toSandboxImageHandle({
      image: input.image,
      provider: input.runtimeProvider,
    }),
  });

  if (preparedImage.provider !== input.runtimeProvider) {
    throw new Error("Sandbox adapter prepared image handle with unexpected provider.");
  }

  return {
    ...input.image,
    imageId: preparedImage.imageId,
    createdAt: preparedImage.createdAt,
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
    resources?: SandboxRuntimeResourceInput;
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
    sandboxInstanceId: input.sandboxInstanceId,
    image: {
      ...input.image,
      createdAt: input.image.createdAt ?? new Date().toISOString(),
    },
    env: createSandboxRuntimeEnv({
      config: ctx.config,
      sandboxInstanceId: input.sandboxInstanceId,
    }),
    ...(input.resources === undefined ? {} : { resources: input.resources }),
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
