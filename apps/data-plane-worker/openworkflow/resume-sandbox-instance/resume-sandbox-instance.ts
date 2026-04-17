import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import type { DataPlaneDatabase } from "@mistle/db/data-plane";
import { SandboxProvider, type SandboxAdapter, type SandboxRuntimeControl } from "@mistle/sandbox";
import { isSandboxResourceNotFoundError } from "@mistle/sandbox";
import type { Clock, Sleeper } from "@mistle/time";

import type { SandboxRuntimeStateReader } from "../../runtime-state/sandbox-runtime-state-reader.js";
import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { attachSandboxStorage } from "../shared/attach-sandbox-storage.js";
import { formatPersistedFailureMessage } from "../shared/format-persisted-failure-message.js";
import { stopSandbox } from "../shared/stop-sandbox.js";
import { markSandboxInstanceFailed } from "../start-sandbox-instance/mark-sandbox-instance-failed.js";
import { markSandboxInstanceRunning } from "../start-sandbox-instance/mark-sandbox-instance-running.js";
import { resumeSandboxRuntime } from "../start-sandbox-instance/resume-sandbox-runtime.js";
import { waitForSandboxRuntimeReadiness } from "../start-sandbox-instance/wait-for-sandbox-runtime-readiness.js";
import { markSandboxInstanceStarting } from "./mark-sandbox-instance-starting.js";
import { replacePersistentSandboxCompute } from "./replace-persistent-sandbox-compute.js";
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
    controlPlaneInternalClient: ControlPlaneInternalClient;
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
  const persistenceMode = resumableSandboxInstance.persistenceMode;

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
            db: ctx.db,
            controlPlaneInternalClient: ctx.controlPlaneInternalClient,
            config: ctx.config,
            sandboxAdapter: ctx.sandboxAdapter,
          },
          {
            sandboxInstanceId: input.sandboxInstanceId,
            persistenceMode,
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
  let storageAttachLifecycle: "start" | "resume";
  let replacedProviderSandboxId: string | undefined;
  if (resumableSandboxInstance.providerSandboxId !== null) {
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
      storageAttachLifecycle = "resume";
    } catch (error) {
      if (persistenceMode !== "persistent" || !isSandboxResourceNotFoundError(error)) {
        await handleFailedResume({
          sandboxInstanceId: input.sandboxInstanceId,
          failureCode: ResumeSandboxFailureCodes.RESUME_SANDBOX_FAILED,
          failureMessage: formatPersistedFailureMessage({
            summary: "Failed to resume sandbox runtime.",
            error,
          }),
        });
        throw error;
      }

      resumedRuntime = await replacePersistentSandboxCompute({
        db: ctx.db,
        controlPlaneInternalClient: ctx.controlPlaneInternalClient,
        config: ctx.config,
        sandboxAdapter: ctx.sandboxAdapter,
        sandboxRuntimeControl: ctx.sandboxRuntimeControl,
        resumableSandboxInstance,
      });
      storageAttachLifecycle = "start";
      replacedProviderSandboxId = resumableSandboxInstance.providerSandboxId;
    }
  } else {
    if (persistenceMode !== "persistent") {
      const error = new Error(
        `Expected resumable sandbox instance '${input.sandboxInstanceId}' to have a provider sandbox id.`,
      );
      await handleFailedResume({
        sandboxInstanceId: input.sandboxInstanceId,
        failureCode: ResumeSandboxFailureCodes.RESUME_SANDBOX_FAILED,
        failureMessage: formatPersistedFailureMessage({
          summary: "Failed to resume sandbox runtime.",
          error,
        }),
      });
      throw error;
    }

    resumedRuntime = await replacePersistentSandboxCompute({
      db: ctx.db,
      controlPlaneInternalClient: ctx.controlPlaneInternalClient,
      config: ctx.config,
      sandboxAdapter: ctx.sandboxAdapter,
      sandboxRuntimeControl: ctx.sandboxRuntimeControl,
      resumableSandboxInstance,
    });
    storageAttachLifecycle = "start";
  }

  if (storageAttachLifecycle === "start") {
    let replacementSandboxRuntimeReady: boolean;
    try {
      replacementSandboxRuntimeReady = await waitForSandboxRuntimeReadiness(
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
        failureMessage: formatPersistedFailureMessage({
          summary: "Failed while waiting for replacement sandbox runtime readiness.",
          error,
        }),
      });
      throw error;
    }

    if (!replacementSandboxRuntimeReady) {
      await handleFailedResume({
        sandboxInstanceId: input.sandboxInstanceId,
        runtimeProvider: resumedRuntime.runtimeProvider,
        providerSandboxId: resumedRuntime.providerSandboxId,
        failureCode: ResumeSandboxFailureCodes.TUNNEL_CONNECT_ACK_TIMEOUT,
        failureMessage: "Timed out waiting for replacement sandbox runtime readiness.",
      });
      throw new Error("Timed out waiting for replacement sandbox runtime readiness.");
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
        failureMessage: formatPersistedFailureMessage({
          summary: "Failed to mark replacement sandbox instance as running.",
          error,
        }),
      });
      throw error;
    }

    if (replacedProviderSandboxId !== undefined) {
      try {
        await ctx.sandboxAdapter.destroy({
          id: replacedProviderSandboxId,
        });
      } catch (error) {
        if (!isSandboxResourceNotFoundError(error)) {
          // Best-effort cleanup only. Replacement compute is already running.
        }
      }
    }

    return;
  }

  try {
    await attachSandboxStorage(
      {
        db: ctx.db,
        controlPlaneInternalClient: ctx.controlPlaneInternalClient,
        workerConfig: ctx.config.app,
        configuredSandboxProvider: ctx.config.sandbox.provider,
        sandboxAdapter: ctx.sandboxAdapter,
        storageBackend: ctx.config.sandbox.storage?.backend,
      },
      {
        organizationId: resumableSandboxInstance.organizationId,
        sandboxInstanceId: input.sandboxInstanceId,
        persistenceMode,
        runtimeProvider: resumedRuntime.runtimeProvider,
        providerSandboxId: resumedRuntime.providerSandboxId,
        lifecycle: storageAttachLifecycle,
      },
    );
  } catch (error) {
    await handleFailedResume({
      sandboxInstanceId: input.sandboxInstanceId,
      runtimeProvider: resumedRuntime.runtimeProvider,
      providerSandboxId: resumedRuntime.providerSandboxId,
      failureCode: ResumeSandboxFailureCodes.SANDBOX_INIT_FAILED,
      failureMessage: formatPersistedFailureMessage({
        summary: "Failed to attach sandbox storage before resume runtime initialization.",
        error,
      }),
    });
    throw error;
  }

  try {
    await resumeSandboxRuntime(
      {
        config: ctx.config,
        sandboxRuntimeControl: ctx.sandboxRuntimeControl,
      },
      {
        sandboxInstanceId: resumedRuntime.sandboxInstanceId,
        providerSandboxId: resumedRuntime.providerSandboxId,
        runtimeProvider: resumedRuntime.runtimeProvider,
        runtimePlan: resumableSandboxInstance.runtimePlan,
      },
    );
  } catch (error) {
    await handleFailedResume({
      sandboxInstanceId: input.sandboxInstanceId,
      runtimeProvider: resumedRuntime.runtimeProvider,
      providerSandboxId: resumedRuntime.providerSandboxId,
      failureCode: ResumeSandboxFailureCodes.SANDBOX_INIT_FAILED,
      failureMessage: formatPersistedFailureMessage({
        summary: "Failed to initialize resumed sandbox runtime.",
        error,
      }),
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
      failureMessage: formatPersistedFailureMessage({
        summary: "Failed while waiting for resumed sandbox runtime readiness.",
        error,
      }),
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
      failureMessage: formatPersistedFailureMessage({
        summary: "Failed to mark resumed sandbox instance as running.",
        error,
      }),
    });
    throw error;
  }
}
