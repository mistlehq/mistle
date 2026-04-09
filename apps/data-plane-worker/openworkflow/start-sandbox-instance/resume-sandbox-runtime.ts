import type { SandboxRuntimeControl } from "@mistle/sandbox";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { createSandboxStartupInput } from "./initialize-sandbox-runtime.js";
import { SandboxStartupModes, encodeSandboxStartupInput } from "./sandbox-startup-input.js";

export async function resumeSandboxRuntime(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    sandboxRuntimeControl: SandboxRuntimeControl;
  },
  input: {
    sandboxInstanceId: string;
    providerSandboxId: string;
    runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
  },
): Promise<void> {
  const startupInput = await createSandboxStartupInput({
    config: ctx.config,
    sandboxInstanceId: input.sandboxInstanceId,
    startupMode: SandboxStartupModes.EXISTING,
    runtimePlan: input.runtimePlan,
  });

  await ctx.sandboxRuntimeControl.resume({
    id: input.providerSandboxId,
    payload: encodeSandboxStartupInput(startupInput),
  });
}
