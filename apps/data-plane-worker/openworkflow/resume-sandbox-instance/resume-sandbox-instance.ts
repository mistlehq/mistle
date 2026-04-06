import type { DataPlaneDatabase } from "@mistle/db/data-plane";
import { SandboxProvider, type SandboxAdapter, type SandboxRuntimeControl } from "@mistle/sandbox";
import { isSandboxResourceNotFoundError } from "@mistle/sandbox";
import type { Clock, Sleeper } from "@mistle/time";

import type { SandboxRuntimeStateReader } from "../../runtime-state/sandbox-runtime-state-reader.js";
import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { stopSandbox } from "../shared/stop-sandbox.js";
import { initializeSandboxRuntime } from "../start-sandbox-instance/initialize-sandbox-runtime.js";
import { markSandboxInstanceFailed } from "../start-sandbox-instance/mark-sandbox-instance-failed.js";
import { markSandboxInstanceRunning } from "../start-sandbox-instance/mark-sandbox-instance-running.js";
import { SandboxStartupModes } from "../start-sandbox-instance/sandbox-startup-input.js";
import { waitForSandboxRuntimeReadiness } from "../start-sandbox-instance/wait-for-sandbox-runtime-readiness.js";
import { markSandboxInstanceStarting } from "./mark-sandbox-instance-starting.js";
import { resolveResumableSandboxInstanceState } from "./resolve-resumable-sandbox-instance-state.js";
import { resumeSandbox } from "./resume-sandbox.js";

const ResumeSandboxFailureCodes = {
  RESUME_SANDBOX_FAILED: "resume_sandbox_failed",
  SANDBOX_INIT_FAILED: "sandbox_init_failed",
  TUNNEL_CONNECT_ACK_TIMEOUT: "tunnel_connect_ack_timeout",
  TUNNEL_CONNECT_ACK_WAIT_FAILED: "tunnel_connect_ack_wait_failed",
  STATUS_TRANSITION_TO_RUNNING_FAILED: "status_transition_to_running_failed",
} as const;

export async function resumeSandboxInstance(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    db: DataPlaneDatabase;
    sandboxAdapter: SandboxAdapter;
    sandboxRuntimeControl: SandboxRuntimeControl;
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
    sandboxInstanceId: string;
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

  try {
    // Resuming the provider runtime is not enough to make the sandbox connectable again.
    // The resumed daemon still needs one `startupMode=existing` init payload so it can
    // restore its in-memory runtime state and reconnect its tunnel/process tree.
    await initializeSandboxRuntime(
      {
        config: ctx.config,
        sandboxRuntimeControl: ctx.sandboxRuntimeControl,
      },
      {
        sandboxInstanceId: resumedRuntime.sandboxInstanceId,
        providerSandboxId: resumedRuntime.providerSandboxId,
        startupMode: SandboxStartupModes.EXISTING,
        runtimePlan: resumableSandboxInstance.runtimePlan,
      },
    );
  } catch (error) {
    await handleFailedResume({
      sandboxInstanceId: input.sandboxInstanceId,
      runtimeProvider: resumedRuntime.runtimeProvider,
      providerSandboxId: resumedRuntime.providerSandboxId,
      failureCode: ResumeSandboxFailureCodes.SANDBOX_INIT_FAILED,
      failureMessage: "Failed to initialize resumed sandbox runtime.",
    });
    throw error;
  }

  let sandboxRuntimeReady: boolean;
  try {
    // Runtime readiness is only meaningful after the resumed daemon has accepted
    // init and had a chance to relaunch its bootstrap and adapter processes.
    sandboxRuntimeReady = await waitForSandboxRuntimeReadiness(
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
      failureMessage: "Failed while waiting for resumed sandbox runtime readiness.",
    });
    throw error;
  }

  if (!sandboxRuntimeReady) {
    await handleFailedResume({
      sandboxInstanceId: input.sandboxInstanceId,
      runtimeProvider: resumedRuntime.runtimeProvider,
      providerSandboxId: resumedRuntime.providerSandboxId,
      failureCode: ResumeSandboxFailureCodes.TUNNEL_CONNECT_ACK_TIMEOUT,
      failureMessage: "Timed out waiting for resumed sandbox runtime readiness.",
    });
    throw new Error("Timed out waiting for resumed sandbox runtime readiness.");
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
