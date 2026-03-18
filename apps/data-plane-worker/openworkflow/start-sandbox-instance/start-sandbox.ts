import type { SandboxAdapter, SandboxProvider } from "@mistle/sandbox";
import type {
  StartSandboxInstanceWorkflowImageInput,
  StartSandboxInstanceWorkflowInput,
} from "@mistle/workflow-registry/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { writeSandboxStartupInput } from "./write-sandbox-startup-input.js";

const SandboxRuntimeTokenizerProxyEgressBaseURLEnv =
  "SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL";
const SandboxRuntimeTelemetryTracesEndpointEnv = "SANDBOX_RUNTIME_TELEMETRY_TRACES_ENDPOINT";
const SandboxRuntimeSandboxInstanceIDEnv = "SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID";

export async function startSandbox(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    sandboxAdapter: SandboxAdapter;
  },
  input: {
    sandboxInstanceId: string;
    image: StartSandboxInstanceWorkflowImageInput;
    runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
  },
): Promise<{
  sandboxInstanceId: string;
  runtimeProvider: SandboxProvider;
  providerRuntimeId: string;
}> {
  const sandboxRuntimeTracesEndpoint =
    ctx.config.telemetry.enabled && ctx.config.sandbox.provider === "docker"
      ? ctx.config.app.sandbox.docker?.tracesEndpoint
      : undefined;

  const startedSandbox = await ctx.sandboxAdapter.start({
    image: {
      ...input.image,
      provider: ctx.config.sandbox.provider,
    },
    env: {
      [SandboxRuntimeTokenizerProxyEgressBaseURLEnv]:
        ctx.config.app.sandbox.tokenizerProxyEgressBaseUrl,
      [SandboxRuntimeSandboxInstanceIDEnv]: input.sandboxInstanceId,
      ...(sandboxRuntimeTracesEndpoint === undefined
        ? {}
        : {
            [SandboxRuntimeTelemetryTracesEndpointEnv]: sandboxRuntimeTracesEndpoint,
          }),
    },
  });

  if (startedSandbox.provider !== ctx.config.sandbox.provider) {
    throw new Error("Sandbox adapter returned sandbox handle with unexpected provider.");
  }

  await writeSandboxStartupInput({
    config: ctx.config,
    sandboxAdapter: ctx.sandboxAdapter,
    sandboxInstanceId: input.sandboxInstanceId,
    runtimePlan: input.runtimePlan,
    sandbox: startedSandbox,
  });

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    runtimeProvider: startedSandbox.provider,
    providerRuntimeId: startedSandbox.runtimeId,
  };
}
