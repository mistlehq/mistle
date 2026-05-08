import { SandboxProvider, type SandboxAdapter, type SandboxRuntimeControl } from "@mistle/sandbox";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { createSandboxStartupInput } from "./initialize-sandbox-runtime.js";
import {
  SandboxStartupModes,
  type SandboxStartupMode,
  encodeSandboxStartupInput,
} from "./sandbox-startup-input.js";
import { createSandboxRuntimeEnv } from "./start-sandbox.js";

function assertUnreachable(_value: never): never {
  throw new Error("Unsupported sandbox provider for resume startup mode resolution.");
}

export function resolveResumeStartupMode(input: {
  runtimeProvider: SandboxProvider;
}): SandboxStartupMode {
  if (input.runtimeProvider === SandboxProvider.DOCKER) {
    return SandboxStartupModes.NEW;
  }

  if (input.runtimeProvider === SandboxProvider.E2B) {
    return SandboxStartupModes.EXISTING;
  }

  return assertUnreachable(input.runtimeProvider);
}

export async function resumeSandboxRuntime(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    processEnv: Readonly<Record<string, string | undefined>>;
    sandboxAdapter: SandboxAdapter;
    sandboxRuntimeControl: SandboxRuntimeControl;
  },
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    providerSandboxId: string;
    runtimeProvider: SandboxProvider;
    runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
    actingUserId?: StartSandboxInstanceWorkflowInput["actingUserId"];
    gitIdentity?: StartSandboxInstanceWorkflowInput["gitIdentity"];
  },
): Promise<void> {
  const startupInput = await createSandboxStartupInput({
    config: ctx.config,
    organizationId: input.organizationId,
    sandboxInstanceId: input.sandboxInstanceId,
    startupMode: resolveResumeStartupMode({
      runtimeProvider: input.runtimeProvider,
    }),
    runtimePlan: input.runtimePlan,
    ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
    ...(input.gitIdentity === undefined ? {} : { gitIdentity: input.gitIdentity }),
    sandboxAdapter: ctx.sandboxAdapter,
    processEnv: ctx.processEnv,
  });

  await ctx.sandboxRuntimeControl.resume({
    id: input.providerSandboxId,
    payload: encodeSandboxStartupInput(startupInput),
    env: createSandboxRuntimeEnv({
      config: ctx.config,
      sandboxInstanceId: input.sandboxInstanceId,
    }),
  });
}
