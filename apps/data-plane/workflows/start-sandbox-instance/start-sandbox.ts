import type { SandboxAdapter } from "@mistle/sandbox";

import type { DataPlaneWorkerRuntimeConfig } from "../../src/worker/types.js";
import type { StartSandboxInput, StartSandboxOutput } from "./types.js";
import { writeSandboxStartupInput } from "./write-sandbox-startup-input.js";

const SandboxRuntimeTokenizerProxyEgressBaseURLEnv =
  "SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL";
const SandboxRuntimeTelemetryTracesEndpointEnv = "SANDBOX_RUNTIME_TELEMETRY_TRACES_ENDPOINT";
const SandboxRuntimeSandboxInstanceIDEnv = "SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID";

type ResolveSandboxRuntimeTracesEndpointInput = {
  sandboxProvider: DataPlaneWorkerRuntimeConfig["sandbox"]["provider"];
  telemetryConfig: DataPlaneWorkerRuntimeConfig["telemetry"];
};

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function resolveSandboxRuntimeTracesEndpoint(
  input: ResolveSandboxRuntimeTracesEndpointInput,
): string | undefined {
  if (!input.telemetryConfig.enabled) {
    return undefined;
  }

  const parsedURL = new URL(input.telemetryConfig.traces.endpoint);

  if (input.sandboxProvider === "docker" && isLoopbackHostname(parsedURL.hostname)) {
    parsedURL.hostname = "host.docker.internal";
  }

  return parsedURL.toString();
}

export async function startSandbox(
  deps: {
    config: DataPlaneWorkerRuntimeConfig;
    sandboxAdapter: SandboxAdapter;
  },
  input: StartSandboxInput,
): Promise<StartSandboxOutput> {
  const sandboxRuntimeTracesEndpoint = resolveSandboxRuntimeTracesEndpoint({
    sandboxProvider: deps.config.sandbox.provider,
    telemetryConfig: deps.config.telemetry,
  });

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
