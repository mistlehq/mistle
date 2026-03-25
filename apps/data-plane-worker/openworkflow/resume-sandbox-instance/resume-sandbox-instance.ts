import type { DataPlaneDatabase, SandboxInstanceProvider } from "@mistle/db/data-plane";
import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { SandboxProvider, type SandboxAdapter } from "@mistle/sandbox";
import { isSandboxResourceNotFoundError } from "@mistle/sandbox";
import type { Clock, Sleeper } from "@mistle/time";

import type { SandboxRuntimeStateReader } from "../../runtime-state/sandbox-runtime-state-reader.js";
import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { stopSandbox } from "../shared/stop-sandbox.js";
import { markSandboxInstanceFailed } from "../start-sandbox-instance/mark-sandbox-instance-failed.js";
import { markSandboxInstanceRunning } from "../start-sandbox-instance/mark-sandbox-instance-running.js";
import { waitForSandboxTunnelReadiness } from "../start-sandbox-instance/wait-for-sandbox-tunnel-readiness.js";
import { markSandboxInstanceStarting } from "./mark-sandbox-instance-starting.js";
import { resumeSandbox } from "./resume-sandbox.js";

const ResumeSandboxFailureCodes = {
  RESUME_SANDBOX_FAILED: "resume_sandbox_failed",
  TUNNEL_CONNECT_ACK_TIMEOUT: "tunnel_connect_ack_timeout",
  TUNNEL_CONNECT_ACK_WAIT_FAILED: "tunnel_connect_ack_wait_failed",
  STATUS_TRANSITION_TO_RUNNING_FAILED: "status_transition_to_running_failed",
} as const;

type ResumableSandboxInstanceState = {
  sandboxInstanceId: string;
  runtimeProvider: SandboxProvider;
  providerSandboxId: string;
};

function toSandboxProvider(provider: SandboxInstanceProvider): SandboxProvider {
  if (provider === "docker") {
    return SandboxProvider.DOCKER;
  }

  if (provider === "e2b") {
    return SandboxProvider.E2B;
  }

  throw new Error("Unsupported sandbox provider for resume flow.");
}

async function resolveResumableSandboxInstanceState(input: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
}): Promise<ResumableSandboxInstanceState | null> {
  const sandboxInstance = await input.db.query.sandboxInstances.findFirst({
    columns: {
      runtimeProvider: true,
      providerSandboxId: true,
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

  if (
    sandboxInstance.status !== SandboxInstanceStatuses.STOPPED &&
    sandboxInstance.status !== SandboxInstanceStatuses.FAILED
  ) {
    throw new Error(
      `Expected sandbox instance '${input.sandboxInstanceId}' to be stopped, failed, starting, or running before resume execution.`,
    );
  }

  if (sandboxInstance.providerSandboxId === null) {
    throw new Error(
      `Expected resumable sandbox instance '${input.sandboxInstanceId}' to have a provider sandbox id.`,
    );
  }

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    runtimeProvider: toSandboxProvider(sandboxInstance.runtimeProvider),
    providerSandboxId: sandboxInstance.providerSandboxId,
  };
}

export async function resumeSandboxInstance(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    db: DataPlaneDatabase;
    sandboxAdapter: SandboxAdapter;
    runtimeStateReader: SandboxRuntimeStateReader;
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
    providerSandboxId?: string;
    failureCode: string;
    failureMessage: string;
  }): Promise<void> {
    let stopSandboxError: unknown;
    if (input.runtimeProvider !== undefined && input.providerSandboxId !== undefined) {
      try {
        await stopSandbox(
          {
            config: ctx.config,
            sandboxAdapter: ctx.sandboxAdapter,
          },
          {
            runtimeProvider: input.runtimeProvider,
            providerSandboxId: input.providerSandboxId,
          },
        );
      } catch (error) {
        if (!isSandboxResourceNotFoundError(error)) {
          stopSandboxError = error;
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

    if (stopSandboxError !== undefined && markFailedError !== undefined) {
      throw new Error(
        "Failed to stop sandbox and failed to mark sandbox instance as failed after resume failure.",
        {
          cause: {
            stopSandboxError,
            markFailedError,
          },
        },
      );
    }

    if (stopSandboxError !== undefined) {
      throw new Error("Failed to stop sandbox after resume failure.", {
        cause: stopSandboxError,
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
    providerSandboxId: string;
  };
  try {
    resumedRuntime = await resumeSandbox(
      {
        config: ctx.config,
        sandboxAdapter: ctx.sandboxAdapter,
      },
      {
        sandboxInstanceId: resumableSandboxInstance.sandboxInstanceId,
        providerSandboxId: resumableSandboxInstance.providerSandboxId,
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

  let tunnelReady: boolean;
  try {
    tunnelReady = await waitForSandboxTunnelReadiness(
      {
        runtimeStateReader: ctx.runtimeStateReader,
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
      providerSandboxId: resumedRuntime.providerSandboxId,
      failureCode: ResumeSandboxFailureCodes.TUNNEL_CONNECT_ACK_WAIT_FAILED,
      failureMessage: "Failed while waiting for resumed sandbox tunnel readiness.",
    });
    throw error;
  }

  if (!tunnelReady) {
    await handleFailedResume({
      sandboxInstanceId: input.sandboxInstanceId,
      runtimeProvider: resumedRuntime.runtimeProvider,
      providerSandboxId: resumedRuntime.providerSandboxId,
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
      providerSandboxId: resumedRuntime.providerSandboxId,
      failureCode: ResumeSandboxFailureCodes.STATUS_TRANSITION_TO_RUNNING_FAILED,
      failureMessage: "Failed to mark resumed sandbox instance as running.",
    });
    throw error;
  }
}
