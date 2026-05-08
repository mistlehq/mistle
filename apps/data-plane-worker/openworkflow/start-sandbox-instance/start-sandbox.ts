import type {
  SandboxAdapter,
  SandboxProvider,
  SandboxStartStoragePreparation,
} from "@mistle/sandbox";
import type { StartSandboxInstanceWorkflowImageInput } from "@mistle/workflow-registry/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";

const SandboxRuntimeSandboxInstanceIDEnv = "SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID";
const SandboxdTestFaultsEnabledEnv = "MISTLE_SANDBOXD_ENABLE_TEST_FAULTS";
const GatewayProxyEnabledEnv = "GATEWAY_PROXY_ENABLED";

export function createSandboxRuntimeEnv(input: {
  config: DataPlaneWorkerRuntimeConfig;
  processEnv?: Readonly<Record<string, string | undefined>>;
  sandboxInstanceId: string;
}): Record<string, string> {
  const gatewayProxyEnabled = readGatewayProxyEnabled(input.processEnv ?? process.env);
  return {
    [SandboxRuntimeSandboxInstanceIDEnv]: input.sandboxInstanceId,
    ...(gatewayProxyEnabled
      ? {
          [GatewayProxyEnabledEnv]: "1",
        }
      : {}),
    ...(input.config.app.sandbox.sandboxdTestFaultsEnabled === true
      ? {
          [SandboxdTestFaultsEnabledEnv]: "1",
        }
      : {}),
  };
}

function readGatewayProxyEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env[GatewayProxyEnabledEnv];
  if (value === undefined || value === "") {
    return false;
  }
  if (value === "1") {
    return true;
  }
  throw new Error(`${GatewayProxyEnabledEnv} must be '1' when set.`);
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
      processEnv: ctx.processEnv,
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
