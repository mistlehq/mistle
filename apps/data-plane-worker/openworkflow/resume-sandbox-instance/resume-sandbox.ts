import type { SandboxInstanceVolumeMode } from "@mistle/db/data-plane";
import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import type { SandboxAdapter, SandboxProvider, SandboxVolumeHandleV1 } from "@mistle/sandbox";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { SandboxStartupInstanceVolumeStates } from "../start-sandbox-instance/sandbox-startup-input.js";
import {
  createSandboxRuntimeEnv,
  SandboxRuntimeInstanceVolumeMountPath,
} from "../start-sandbox-instance/start-sandbox.js";
import { writeSandboxStartupInput } from "../start-sandbox-instance/write-sandbox-startup-input.js";

export async function resumeSandbox(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    sandboxAdapter: SandboxAdapter;
  },
  input: {
    sandboxInstanceId: string;
    imageId: string;
    imageCreatedAt: string;
    instanceVolume: SandboxVolumeHandleV1;
    instanceVolumeMode: SandboxInstanceVolumeMode;
    previousProviderRuntimeId: string | null;
    runtimePlan: CompiledRuntimePlan;
  },
): Promise<{
  sandboxInstanceId: string;
  runtimeProvider: SandboxProvider;
  providerRuntimeId: string;
}> {
  const resumedSandbox = await ctx.sandboxAdapter.resume({
    image: {
      provider: ctx.config.sandbox.provider,
      imageId: input.imageId,
      createdAt: input.imageCreatedAt,
    },
    mounts: [
      {
        volume: input.instanceVolume,
        mountPath: SandboxRuntimeInstanceVolumeMountPath,
      },
    ],
    previousRuntimeId: input.previousProviderRuntimeId,
    env: createSandboxRuntimeEnv({
      config: ctx.config,
      sandboxInstanceId: input.sandboxInstanceId,
    }),
  });

  if (resumedSandbox.provider !== ctx.config.sandbox.provider) {
    throw new Error("Sandbox adapter returned sandbox handle with unexpected provider.");
  }

  await writeSandboxStartupInput({
    config: ctx.config,
    sandboxAdapter: ctx.sandboxAdapter,
    sandboxInstanceId: input.sandboxInstanceId,
    runtimePlan: input.runtimePlan,
    instanceVolumeMode: input.instanceVolumeMode,
    instanceVolumeState: SandboxStartupInstanceVolumeStates.EXISTING,
    sandbox: resumedSandbox,
  });

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    runtimeProvider: resumedSandbox.provider,
    providerRuntimeId: resumedSandbox.runtimeId,
  };
}
