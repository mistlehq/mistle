import type { SandboxAdapter } from "@mistle/sandbox";

import type { DataPlaneWorkerRuntimeConfig } from "../../types.js";
import type { StartSandboxInput, StartSandboxOutput } from "./types.js";
import { writeSandboxStartupInput } from "./write-sandbox-startup-input.js";

const SandboxRuntimeTokenizerProxyEgressBaseURLEnv =
  "SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL";
const SandboxRuntimeTelemetryTracesEndpointEnv = "SANDBOX_RUNTIME_TELEMETRY_TRACES_ENDPOINT";
const SandboxRuntimeSandboxInstanceIDEnv = "SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID";

export async function startSandbox(
  deps: {
    config: DataPlaneWorkerRuntimeConfig;
    sandboxAdapter: SandboxAdapter;
  },
  input: StartSandboxInput,
): Promise<StartSandboxOutput> {
  const sandboxRuntimeTracesEndpoint =
    deps.config.telemetry.enabled && deps.config.sandbox.provider === "docker"
      ? deps.config.app.sandbox.docker?.tracesEndpoint
      : undefined;

  const startedSandbox = await deps.sandboxAdapter.start({
    image: {
      ...input.image,
      provider: deps.config.sandbox.provider,
    },
    env: {
      [SandboxRuntimeTokenizerProxyEgressBaseURLEnv]:
        deps.config.app.sandbox.tokenizerProxyEgressBaseUrl,
      [SandboxRuntimeSandboxInstanceIDEnv]: input.sandboxInstanceId,
      ...(sandboxRuntimeTracesEndpoint === undefined
        ? {}
        : {
            [SandboxRuntimeTelemetryTracesEndpointEnv]: sandboxRuntimeTracesEndpoint,
          }),
    },
  });

  if (startedSandbox.provider !== deps.config.sandbox.provider) {
    throw new Error("Sandbox adapter returned sandbox handle with unexpected provider.");
  }

  const bootstrapTokenJti = await writeSandboxStartupInput({
    config: deps.config,
    sandboxAdapter: deps.sandboxAdapter,
    sandboxInstanceId: input.sandboxInstanceId,
    runtimePlan: input.runtimePlan,
    sandbox: startedSandbox,
  });

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    provider: startedSandbox.provider,
    providerSandboxId: startedSandbox.sandboxId,
    bootstrapTokenJti,
  };
}
