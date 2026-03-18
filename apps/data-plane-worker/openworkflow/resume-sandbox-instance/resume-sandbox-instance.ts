import type {
  DataPlaneDatabase,
  SandboxInstanceVolumeMode,
  SandboxInstanceVolumeProvider,
} from "@mistle/db/data-plane";
import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { CompiledRuntimePlanSchema, type CompiledRuntimePlan } from "@mistle/integrations-core";
import { SandboxProvider, type SandboxAdapter, type SandboxVolumeHandleV1 } from "@mistle/sandbox";
import { isSandboxResourceNotFoundError } from "@mistle/sandbox";
import type { Clock, Sleeper } from "@mistle/time";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { destroySandbox } from "../shared/destroy-sandbox.js";
import { markSandboxInstanceFailed } from "../start-sandbox-instance/mark-sandbox-instance-failed.js";
import { markSandboxInstanceRunning } from "../start-sandbox-instance/mark-sandbox-instance-running.js";
import { waitForSandboxTunnelReadiness } from "../start-sandbox-instance/wait-for-sandbox-tunnel-readiness.js";
import { markSandboxInstanceStarting } from "./mark-sandbox-instance-starting.js";
import { persistSandboxInstanceRuntimeAttachment } from "./persist-sandbox-instance-runtime-attachment.js";
import { resumeSandbox } from "./resume-sandbox.js";

const ResumeSandboxFailureCodes = {
  RESUME_SANDBOX_FAILED: "resume_sandbox_failed",
  PERSIST_RUNTIME_ATTACHMENT_FAILED: "persist_runtime_attachment_failed",
  TUNNEL_CONNECT_ACK_TIMEOUT: "tunnel_connect_ack_timeout",
  TUNNEL_CONNECT_ACK_WAIT_FAILED: "tunnel_connect_ack_wait_failed",
  STATUS_TRANSITION_TO_RUNNING_FAILED: "status_transition_to_running_failed",
} as const;

type ResumableSandboxInstanceState = {
  sandboxInstanceId: string;
  runtimeProvider: SandboxProvider;
  previousProviderRuntimeId: string | null;
  imageId: string;
  imageCreatedAt: string;
  instanceVolume: SandboxVolumeHandleV1;
  instanceVolumeMode: SandboxInstanceVolumeMode;
  runtimePlan: CompiledRuntimePlan;
};

function toSandboxProvider(provider: SandboxInstanceVolumeProvider): SandboxProvider {
  if (provider === "docker") {
    return SandboxProvider.DOCKER;
  }

  return SandboxProvider.MODAL;
}

async function resolveResumableSandboxInstanceState(input: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
}): Promise<ResumableSandboxInstanceState | null> {
  const sandboxInstance = await input.db.query.sandboxInstances.findFirst({
    columns: {
      runtimeProvider: true,
      providerRuntimeId: true,
      instanceVolumeProvider: true,
      instanceVolumeId: true,
      instanceVolumeMode: true,
      status: true,
    },
    where: (table, { eq }) => eq(table.id, input.sandboxInstanceId),
  });

  if (sandboxInstance === undefined) {
    throw new Error(`Sandbox instance '${input.sandboxInstanceId}' was not found.`);
  }

  if (
    sandboxInstance.status === SandboxInstanceStatuses.RUNNING ||
    sandboxInstance.status === SandboxInstanceStatuses.STARTING
  ) {
    return null;
  }

  if (sandboxInstance.status !== SandboxInstanceStatuses.STOPPED) {
    throw new Error(
      `Expected sandbox instance '${input.sandboxInstanceId}' to be stopped, starting, or running before resume execution.`,
    );
  }

  if (
    sandboxInstance.instanceVolumeProvider === null ||
    sandboxInstance.instanceVolumeId === null ||
    sandboxInstance.instanceVolumeMode === null
  ) {
    throw new Error(
      `Expected stopped sandbox instance '${input.sandboxInstanceId}' to have instance volume metadata.`,
    );
  }

  const persistedRuntimePlan = await input.db.query.sandboxInstanceRuntimePlans.findFirst({
    columns: {
      compiledRuntimePlan: true,
      createdAt: true,
    },
    where: (table, { and, eq, isNull }) =>
      and(eq(table.sandboxInstanceId, input.sandboxInstanceId), isNull(table.supersededAt)),
  });

  if (persistedRuntimePlan === undefined) {
    throw new Error(
      `Expected stopped sandbox instance '${input.sandboxInstanceId}' to have an active runtime plan.`,
    );
  }

  const runtimePlan = CompiledRuntimePlanSchema.parse(persistedRuntimePlan.compiledRuntimePlan);

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    runtimeProvider: toSandboxProvider(sandboxInstance.runtimeProvider),
    previousProviderRuntimeId: sandboxInstance.providerRuntimeId,
    imageId: runtimePlan.image.imageRef,
    imageCreatedAt: persistedRuntimePlan.createdAt,
    instanceVolume: {
      provider: toSandboxProvider(sandboxInstance.instanceVolumeProvider),
      volumeId: sandboxInstance.instanceVolumeId,
      createdAt: persistedRuntimePlan.createdAt,
    },
    instanceVolumeMode: sandboxInstance.instanceVolumeMode,
    runtimePlan,
  };
}

export async function resumeSandboxInstance(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    db: DataPlaneDatabase;
    sandboxAdapter: SandboxAdapter;
    tunnelReadinessPolicy: {
      timeoutMs: number;
      pollIntervalMs: number;
    };
    clock: Clock;
    sleeper: Sleeper;
  },
  input: {
    sandboxInstanceId: string;
  },
): Promise<void> {
  const resumableSandboxInstance = await resolveResumableSandboxInstanceState({
    db: ctx.db,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (resumableSandboxInstance === null) {
    return;
  }

  await markSandboxInstanceStarting({
    db: ctx.db,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  async function handleFailedResume(input: {
    sandboxInstanceId: string;
    runtimeProvider?: SandboxProvider;
    providerRuntimeId?: string;
    failureCode: string;
    failureMessage: string;
  }): Promise<void> {
    let destroySandboxError: unknown;
    if (input.runtimeProvider !== undefined && input.providerRuntimeId !== undefined) {
      try {
        await destroySandbox(
          {
            config: ctx.config,
            sandboxAdapter: ctx.sandboxAdapter,
          },
          {
            runtimeProvider: input.runtimeProvider,
            providerRuntimeId: input.providerRuntimeId,
          },
        );
      } catch (error) {
        if (!isSandboxResourceNotFoundError(error)) {
          destroySandboxError = error;
        }
      }
    }

    let markFailedError: unknown;
    try {
      await markSandboxInstanceFailed(
        {
          db: ctx.db,
        },
        {
          sandboxInstanceId: input.sandboxInstanceId,
          failureCode: input.failureCode,
          failureMessage: input.failureMessage,
        },
      );
    } catch (error) {
      markFailedError = error;
    }

    if (destroySandboxError !== undefined && markFailedError !== undefined) {
      throw new Error(
        "Failed to destroy sandbox and failed to mark sandbox instance as failed after resume failure.",
        {
          cause: {
            destroySandboxError,
            markFailedError,
          },
        },
      );
    }

    if (destroySandboxError !== undefined) {
      throw new Error("Failed to destroy sandbox after resume failure.", {
        cause: destroySandboxError,
      });
    }

    if (markFailedError !== undefined) {
      throw new Error("Failed to mark sandbox instance as failed after resume failure.", {
        cause: markFailedError,
      });
    }
  }

  let resumedRuntime: {
    runtimeProvider: SandboxProvider;
    providerRuntimeId: string;
  };
  try {
    resumedRuntime = await resumeSandbox(
      {
        config: ctx.config,
        sandboxAdapter: ctx.sandboxAdapter,
      },
      {
        sandboxInstanceId: resumableSandboxInstance.sandboxInstanceId,
        imageId: resumableSandboxInstance.imageId,
        imageCreatedAt: resumableSandboxInstance.imageCreatedAt,
        instanceVolume: resumableSandboxInstance.instanceVolume,
        instanceVolumeMode: resumableSandboxInstance.instanceVolumeMode,
        previousProviderRuntimeId: resumableSandboxInstance.previousProviderRuntimeId,
        runtimePlan: resumableSandboxInstance.runtimePlan,
      },
    );
  } catch (error) {
    await handleFailedResume({
      sandboxInstanceId: input.sandboxInstanceId,
      failureCode: ResumeSandboxFailureCodes.RESUME_SANDBOX_FAILED,
      failureMessage: "Failed to resume sandbox runtime.",
    });
    throw error;
  }

  try {
    await persistSandboxInstanceRuntimeAttachment(
      {
        db: ctx.db,
      },
      {
        sandboxInstanceId: input.sandboxInstanceId,
        providerRuntimeId: resumedRuntime.providerRuntimeId,
      },
    );
  } catch (error) {
    await handleFailedResume({
      sandboxInstanceId: input.sandboxInstanceId,
      runtimeProvider: resumedRuntime.runtimeProvider,
      providerRuntimeId: resumedRuntime.providerRuntimeId,
      failureCode: ResumeSandboxFailureCodes.PERSIST_RUNTIME_ATTACHMENT_FAILED,
      failureMessage: "Failed to persist resumed runtime attachment metadata.",
    });
    throw error;
  }

  let tunnelReady: boolean;
  try {
    tunnelReady = await waitForSandboxTunnelReadiness(
      {
        db: ctx.db,
        policy: ctx.tunnelReadinessPolicy,
        clock: ctx.clock,
        sleeper: ctx.sleeper,
      },
      {
        sandboxInstanceId: input.sandboxInstanceId,
      },
    );
  } catch (error) {
    await handleFailedResume({
      sandboxInstanceId: input.sandboxInstanceId,
      runtimeProvider: resumedRuntime.runtimeProvider,
      providerRuntimeId: resumedRuntime.providerRuntimeId,
      failureCode: ResumeSandboxFailureCodes.TUNNEL_CONNECT_ACK_WAIT_FAILED,
      failureMessage: "Failed while waiting for resumed sandbox tunnel readiness.",
    });
    throw error;
  }

  if (!tunnelReady) {
    await handleFailedResume({
      sandboxInstanceId: input.sandboxInstanceId,
      runtimeProvider: resumedRuntime.runtimeProvider,
      providerRuntimeId: resumedRuntime.providerRuntimeId,
      failureCode: ResumeSandboxFailureCodes.TUNNEL_CONNECT_ACK_TIMEOUT,
      failureMessage: "Timed out waiting for resumed sandbox tunnel readiness.",
    });
    throw new Error("Timed out waiting for resumed sandbox tunnel readiness.");
  }

  try {
    await markSandboxInstanceRunning(
      {
        db: ctx.db,
      },
      {
        sandboxInstanceId: input.sandboxInstanceId,
      },
    );
  } catch (error) {
    await handleFailedResume({
      sandboxInstanceId: input.sandboxInstanceId,
      runtimeProvider: resumedRuntime.runtimeProvider,
      providerRuntimeId: resumedRuntime.providerRuntimeId,
      failureCode: ResumeSandboxFailureCodes.STATUS_TRANSITION_TO_RUNNING_FAILED,
      failureMessage: "Failed to mark resumed sandbox instance as running.",
    });
    throw error;
  }
}
