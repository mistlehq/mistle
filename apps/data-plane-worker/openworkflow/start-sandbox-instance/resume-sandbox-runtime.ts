import type { MistleLogger } from "@mistle/logging";
import { SandboxProvider, type SandboxAdapter, type SandboxRuntimeControl } from "@mistle/sandbox";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";
import { trace, type Attributes } from "@opentelemetry/api";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import type { SandboxdArtifactResolver } from "../core/sandboxd-artifact-resolver.js";
import { createSandboxStartupInput } from "./initialize-sandbox-runtime.js";
import {
  SandboxStartupModes,
  type SandboxStartupInput,
  encodeSandboxStartupInput,
} from "./sandbox-startup-input.js";
import { createSandboxRuntimeEnv } from "./start-sandbox.js";

function addResumeRuntimeEvent(input: {
  event: string;
  providerSandboxId: string;
  runtimeProvider: SandboxProvider;
  sandboxInstanceId: string;
  attributes?: Attributes;
}): void {
  trace.getActiveSpan()?.addEvent(input.event, {
    "mistle.sandbox.instance_id": input.sandboxInstanceId,
    "mistle.sandbox.provider_sandbox_id": input.providerSandboxId,
    "mistle.sandbox.runtime_provider": input.runtimeProvider,
    ...(input.attributes ?? {}),
  });
}

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
    addResumeRuntimeEvent({
      event: "sandbox_resume_runtime.ensure_sandboxd.started",
      providerSandboxId: input.providerSandboxId,
      runtimeProvider: input.runtimeProvider,
      sandboxInstanceId: input.sandboxInstanceId,
      attributes: {
        "mistle.sandbox.sandboxd.version": sandboxdArtifact.version,
      },
    });
    await ctx.sandboxRuntimeControl.ensureSandboxd({
      id: input.providerSandboxId,
      artifact: sandboxdArtifact,
      env: runtimeEnv,
    });
    addResumeRuntimeEvent({
      event: "sandbox_resume_runtime.ensure_sandboxd.completed",
      providerSandboxId: input.providerSandboxId,
      runtimeProvider: input.runtimeProvider,
      sandboxInstanceId: input.sandboxInstanceId,
      attributes: {
        "mistle.sandbox.sandboxd.version": sandboxdArtifact.version,
      },
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

  addResumeRuntimeEvent({
    event: "sandbox_resume_runtime.read_sandboxd_version.started",
    providerSandboxId: input.providerSandboxId,
    runtimeProvider: input.runtimeProvider,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const sandboxdVersion = await ctx.sandboxRuntimeControl.readSandboxdVersion({
    id: input.providerSandboxId,
    env: runtimeEnv,
  });
  addResumeRuntimeEvent({
    event: "sandbox_resume_runtime.read_sandboxd_version.completed",
    providerSandboxId: input.providerSandboxId,
    runtimeProvider: input.runtimeProvider,
    sandboxInstanceId: input.sandboxInstanceId,
    attributes: {
      "mistle.sandbox.sandboxd.version": sandboxdVersion,
    },
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
    addResumeRuntimeEvent({
      event: "sandbox_resume_runtime.begin_init.started",
      providerSandboxId: input.providerSandboxId,
      runtimeProvider: input.runtimeProvider,
      sandboxInstanceId: input.sandboxInstanceId,
    });
    await ctx.sandboxRuntimeControl.beginInit(runtimeControlRequest);
    addResumeRuntimeEvent({
      event: "sandbox_resume_runtime.begin_init.completed",
      providerSandboxId: input.providerSandboxId,
      runtimeProvider: input.runtimeProvider,
      sandboxInstanceId: input.sandboxInstanceId,
    });
    ctx.logger.info(
      {
        providerSandboxId: input.providerSandboxId,
        runtimeProvider: input.runtimeProvider,
        sandboxInstanceId: input.sandboxInstanceId,
      },
      "Submitted sandboxd initialization for resumed provider runtime.",
    );
    addResumeRuntimeEvent({
      event: "sandbox_resume_runtime.wait_init.started",
      providerSandboxId: input.providerSandboxId,
      runtimeProvider: input.runtimeProvider,
      sandboxInstanceId: input.sandboxInstanceId,
    });
    await ctx.sandboxRuntimeControl.waitInit({
      id: input.providerSandboxId,
      env: runtimeEnv,
    });
    addResumeRuntimeEvent({
      event: "sandbox_resume_runtime.wait_init.completed",
      providerSandboxId: input.providerSandboxId,
      runtimeProvider: input.runtimeProvider,
      sandboxInstanceId: input.sandboxInstanceId,
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
      addResumeRuntimeEvent({
        event: "sandbox_resume_runtime.wait_init.already_in_progress",
        providerSandboxId: input.providerSandboxId,
        runtimeProvider: input.runtimeProvider,
        sandboxInstanceId: input.sandboxInstanceId,
      });
      await ctx.sandboxRuntimeControl.waitInit({
        id: input.providerSandboxId,
        env: runtimeEnv,
      });
      addResumeRuntimeEvent({
        event: "sandbox_resume_runtime.wait_init.completed",
        providerSandboxId: input.providerSandboxId,
        runtimeProvider: input.runtimeProvider,
        sandboxInstanceId: input.sandboxInstanceId,
        attributes: {
          "mistle.sandbox.resume.wait_init_source": "already_in_progress",
        },
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

  addResumeRuntimeEvent({
    event: "sandbox_resume_runtime.resume.started",
    providerSandboxId: input.providerSandboxId,
    runtimeProvider: input.runtimeProvider,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  await ctx.sandboxRuntimeControl.resume(runtimeControlRequest);
  addResumeRuntimeEvent({
    event: "sandbox_resume_runtime.resume.completed",
    providerSandboxId: input.providerSandboxId,
    runtimeProvider: input.runtimeProvider,
    sandboxInstanceId: input.sandboxInstanceId,
  });
}
