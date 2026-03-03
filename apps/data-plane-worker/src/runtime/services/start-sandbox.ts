import type { SandboxAdapter } from "@mistle/sandbox";
import { typeid } from "typeid-js";

import type { DataPlaneWorkerRuntimeConfig } from "../../types.js";
import type { StartSandboxInput, StartSandboxOutput } from "./types.js";
import { writeSandboxStartupInput } from "./write-sandbox-startup-input.js";

const SandboxRuntimeTokenizerProxyEgressBaseURLEnv =
  "SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL";

function createSandboxInstanceId(): string {
  return typeid("sbi").toString();
}

export async function startSandbox(
  deps: {
    config: DataPlaneWorkerRuntimeConfig;
    sandboxAdapter: SandboxAdapter;
  },
  input: StartSandboxInput,
): Promise<StartSandboxOutput> {
  const sandboxInstanceId = createSandboxInstanceId();
  const startedSandbox = await deps.sandboxAdapter.start({
    image: {
      ...input.image,
      provider: deps.config.app.sandbox.provider,
    },
    env: {
      [SandboxRuntimeTokenizerProxyEgressBaseURLEnv]:
        deps.config.app.sandbox.tokenizerProxyEgressBaseUrl,
    },
  });

  if (startedSandbox.provider !== deps.config.app.sandbox.provider) {
    throw new Error("Sandbox adapter returned sandbox handle with unexpected provider.");
  }

  const bootstrapTokenJti = await writeSandboxStartupInput({
    config: deps.config,
    sandboxAdapter: deps.sandboxAdapter,
    sandboxInstanceId,
    runtimePlan: input.runtimePlan,
    sandbox: startedSandbox,
  });

  return {
    sandboxInstanceId,
    provider: startedSandbox.provider,
    providerSandboxId: startedSandbox.sandboxId,
    bootstrapTokenJti,
  };
}
