import type { SandboxInstanceVolumeMode } from "@mistle/db/data-plane";
import type { SandboxAdapter, SandboxProvider, SandboxVolumeHandleV1 } from "@mistle/sandbox";
import type {
  StartSandboxInstanceWorkflowImageInput,
  StartSandboxInstanceWorkflowInput,
} from "@mistle/workflow-registry/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { SandboxStartupInstanceVolumeStates } from "./sandbox-startup-input.js";
import { writeSandboxStartupInput } from "./write-sandbox-startup-input.js";

const SandboxRuntimeTokenizerProxyEgressBaseURLEnv =
  "SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL";
const SandboxRuntimeTelemetryTracesEndpointEnv = "SANDBOX_RUNTIME_TELEMETRY_TRACES_ENDPOINT";
const SandboxRuntimeSandboxInstanceIDEnv = "SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID";

export const SandboxRuntimeInstanceVolumeMountPath = "/home/sandbox";

export function createSandboxRuntimeEnv(input: {
  config: DataPlaneWorkerRuntimeConfig;
  sandboxInstanceId: string;
}): Record<string, string> {
  const sandboxRuntimeTracesEndpoint =
    input.config.telemetry.enabled && input.config.sandbox.provider === "docker"
      ? input.config.app.sandbox.docker?.tracesEndpoint
      : undefined;

  return {
    [SandboxRuntimeTokenizerProxyEgressBaseURLEnv]:
      input.config.app.sandbox.tokenizerProxyEgressBaseUrl,
    [SandboxRuntimeSandboxInstanceIDEnv]: input.sandboxInstanceId,
    ...(sandboxRuntimeTracesEndpoint === undefined
      ? {}
      : {
          [SandboxRuntimeTelemetryTracesEndpointEnv]: sandboxRuntimeTracesEndpoint,
        }),
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
    instanceVolume: SandboxVolumeHandleV1;
    instanceVolumeMode: SandboxInstanceVolumeMode;
    runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
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
    mounts: [
      {
        volume: input.instanceVolume,
        mountPath: SandboxRuntimeInstanceVolumeMountPath,
      },
    ],
    env: createSandboxRuntimeEnv({
      config: ctx.config,
      sandboxInstanceId: input.sandboxInstanceId,
    }),
  });

  if (startedSandbox.provider !== ctx.config.sandbox.provider) {
    throw new Error("Sandbox adapter returned sandbox handle with unexpected provider.");
  }

  await writeSandboxStartupInput({
    config: ctx.config,
    sandboxAdapter: ctx.sandboxAdapter,
    sandboxInstanceId: input.sandboxInstanceId,
    runtimePlan: input.runtimePlan,
    instanceVolumeMode: input.instanceVolumeMode,
    instanceVolumeState: SandboxStartupInstanceVolumeStates.NEW,
    sandbox: startedSandbox,
  });

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    runtimeProvider: startedSandbox.provider,
    providerSandboxId: startedSandbox.id,
  };
}
