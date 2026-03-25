import type { SandboxAdapter, SandboxProvider } from "@mistle/sandbox";
import type { StartSandboxInstanceWorkflowImageInput } from "@mistle/workflow-registry/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";

const SandboxRuntimeTokenizerProxyEgressBaseURLEnv =
  "SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL";
const SandboxRuntimeTelemetryTracesEndpointEnv = "SANDBOX_RUNTIME_TELEMETRY_TRACES_ENDPOINT";
const SandboxRuntimeSandboxInstanceIDEnv = "SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID";

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
