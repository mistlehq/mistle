import type { MistleLogger } from "@mistle/logging";
import { SandboxProvider, type SandboxAdapter, type SandboxRuntimeControl } from "@mistle/sandbox";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import type { SandboxdArtifactResolver } from "../core/sandboxd-artifact-resolver.js";
import { createSandboxStartupInput } from "./initialize-sandbox-runtime.js";
import {
  SandboxStartupModes,
  type SandboxStartupInput,
  encodeSandboxStartupInput,
} from "./sandbox-startup-input.js";
import { createSandboxRuntimeEnv } from "./start-sandbox.js";

export function isSandboxdAlreadyInitializedForResume(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("sandboxd has already completed initialization")
  );
}

export function isSandboxdInitializationAlreadyInProgressForResume(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("sandboxd is already initializing") ||
      error.message.includes("sandboxd init worker is already running"))
  );
}

export async function resumeSandboxRuntime(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    logger: MistleLogger;
    processEnv: Readonly<Record<string, string | undefined>>;
    sandboxAdapter: SandboxAdapter;
    sandboxdArtifactResolver: SandboxdArtifactResolver | undefined;
    sandboxRuntimeControl: SandboxRuntimeControl;
  },
  input: {
    organizationId: string;
    operationId: string;
    operationKind: SandboxStartupInput["operationKind"];
    sandboxInstanceId: string;
    providerSandboxId: string;
    runtimeProvider: SandboxProvider;
    runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
    actingUserId?: StartSandboxInstanceWorkflowInput["actingUserId"];
    gitIdentity?: StartSandboxInstanceWorkflowInput["gitIdentity"];
  },
): Promise<void> {
  const runtimeEnv = createSandboxRuntimeEnv({
    config: ctx.config,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const sandboxdArtifact = await ctx.sandboxdArtifactResolver?.resolve();
  if (sandboxdArtifact !== undefined) {
    await ctx.sandboxRuntimeControl.ensureSandboxd({
      id: input.providerSandboxId,
      artifact: sandboxdArtifact,
      env: runtimeEnv,
    });
    ctx.logger.info(
      {
        providerSandboxId: input.providerSandboxId,
        runtimeProvider: input.runtimeProvider,
        sandboxInstanceId: input.sandboxInstanceId,
        sandboxdVersion: sandboxdArtifact.version,
      },
      "Ensured sandboxd artifact before runtime resume.",
    );
  }

  const sandboxdVersion = await ctx.sandboxRuntimeControl.readSandboxdVersion({
    id: input.providerSandboxId,
    env: runtimeEnv,
  });
  ctx.logger.info(
    {
      providerSandboxId: input.providerSandboxId,
      runtimeProvider: input.runtimeProvider,
      sandboxInstanceId: input.sandboxInstanceId,
      sandboxdVersion,
    },
    "Read sandboxd version before runtime resume.",
  );

  const startupInput = await createSandboxStartupInput({
    config: ctx.config,
    organizationId: input.organizationId,
    operationId: input.operationId,
    operationKind: input.operationKind,
    sandboxInstanceId: input.sandboxInstanceId,
    startupMode: SandboxStartupModes.EXISTING,
    runtimePlan: input.runtimePlan,
    ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
    ...(input.gitIdentity === undefined ? {} : { gitIdentity: input.gitIdentity }),
    sandboxAdapter: ctx.sandboxAdapter,
    processEnv: ctx.processEnv,
  });

  const runtimeControlRequest = {
    id: input.providerSandboxId,
    payload: encodeSandboxStartupInput(startupInput),
    env: runtimeEnv,
  };

  try {
    await ctx.sandboxRuntimeControl.beginInit(runtimeControlRequest);
    ctx.logger.info(
      {
        providerSandboxId: input.providerSandboxId,
        runtimeProvider: input.runtimeProvider,
        sandboxInstanceId: input.sandboxInstanceId,
      },
      "Submitted sandboxd initialization for resumed provider runtime.",
    );
    await ctx.sandboxRuntimeControl.waitInit({
      id: input.providerSandboxId,
      env: runtimeEnv,
    });
    return;
  } catch (error) {
    if (isSandboxdInitializationAlreadyInProgressForResume(error)) {
      ctx.logger.info(
        {
          providerSandboxId: input.providerSandboxId,
          runtimeProvider: input.runtimeProvider,
          sandboxInstanceId: input.sandboxInstanceId,
        },
        "Sandboxd initialization was already in progress before runtime resume.",
      );
      await ctx.sandboxRuntimeControl.waitInit({
        id: input.providerSandboxId,
        env: runtimeEnv,
      });
      return;
    }

    if (!isSandboxdAlreadyInitializedForResume(error)) {
      throw error;
    }

    ctx.logger.info(
      {
        providerSandboxId: input.providerSandboxId,
        runtimeProvider: input.runtimeProvider,
        sandboxInstanceId: input.sandboxInstanceId,
      },
      "Sandboxd was already initialized before runtime resume.",
    );
  }

  await ctx.sandboxRuntimeControl.resume(runtimeControlRequest);
}
