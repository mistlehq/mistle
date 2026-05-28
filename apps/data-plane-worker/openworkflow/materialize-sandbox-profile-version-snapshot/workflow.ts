import { ControlPlaneInternalClientRequestError } from "@mistle/control-plane-internal-client";
import {
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxStopReasons,
} from "@mistle/db/data-plane";
import { SandboxProvider, type SandboxImageHandle } from "@mistle/sandbox";
import { SandboxLifecycleEvents } from "@mistle/sandbox-lifecycle";
import {
  MaterializeSandboxProfileVersionSnapshotWorkflowSpec,
  type MaterializeSandboxProfileVersionSnapshotWorkflowInput,
  type MaterializeSandboxProfileVersionSnapshotWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";
import { rethrowDurableStepErrorForRetry } from "@mistle/workflow-registry/durable-step-retry.js";

import { getWorkflowContext, type WorkflowContext } from "../core/context.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import { applySandboxLifecycleEvent } from "../shared/apply-sandbox-lifecycle-event.js";
import { destroySandbox } from "../shared/destroy-sandbox.js";
import { formatPersistedFailureMessage } from "../shared/format-persisted-failure-message.js";
import { markSandboxInstanceStarting } from "../shared/mark-sandbox-instance-starting.js";
import {
  createWorkerSandboxLifecycleEventRecorder,
  recordWorkerSandboxLifecyclePhase,
} from "../shared/sandbox-operation-events.js";
import { ensureSandboxInstance } from "../start-sandbox-instance/ensure-sandbox-instance.js";
import { initializeSandboxRuntime } from "../start-sandbox-instance/initialize-sandbox-runtime.js";
import { markSandboxInstanceFailed } from "../start-sandbox-instance/mark-sandbox-instance-failed.js";
import { markSandboxInstanceRunning } from "../start-sandbox-instance/mark-sandbox-instance-running.js";
import { persistSandboxInstanceProvisioning } from "../start-sandbox-instance/persist-sandbox-instance-provisioning.js";
import {
  SandboxExecutionModes,
  SandboxStartupModes,
} from "../start-sandbox-instance/sandbox-startup-input.js";
import { prepareSandboxImage, startSandbox } from "../start-sandbox-instance/start-sandbox.js";
import { markSandboxInstanceStopped } from "../stop-sandbox-instance/mark-sandbox-instance-stopped.js";

const SnapshotMaterializationFailureCodes = {
  RUNTIME_PLAN_COMPILE_FAILED: "snapshot_runtime_plan_compile_failed",
  SANDBOX_RUNTIME_RESOLVE_FAILED: "snapshot_sandbox_runtime_resolve_failed",
  STATUS_TRANSITION_TO_STARTING_FAILED: "snapshot_status_transition_to_starting_failed",
  SANDBOX_START_FAILED: "snapshot_sandbox_start_failed",
  PERSIST_PROVISIONING_METADATA_FAILED: "snapshot_persist_provisioning_metadata_failed",
  STATUS_TRANSITION_TO_INITIALIZING_FAILED: "snapshot_status_transition_to_initializing_failed",
  SANDBOX_INIT_FAILED: "snapshot_sandbox_init_failed",
  STATUS_TRANSITION_TO_RUNNING_FAILED: "snapshot_status_transition_to_running_failed",
  SNAPSHOT_CAPTURE_FAILED: "snapshot_capture_failed",
  SANDBOX_DESTROY_FAILED: "snapshot_sandbox_destroy_failed",
  STATUS_TRANSITION_TO_STOPPED_FAILED: "snapshot_status_transition_to_stopped_failed",
} as const;
export const SnapshotProviderRequestTimeoutMs = 5 * 60 * 1000;

type SnapshotCaptureResult =
  | {
      captured: true;
      image: SandboxImageHandle;
    }
  | {
      captured: false;
      errorMessage: string;
    };

type MaterializeSnapshotWorkflowExecutionContext = Pick<
  WorkflowContext,
  | "config"
  | "controlPlaneInternalClient"
  | "clock"
  | "db"
  | "tables"
  | "logger"
  | "processEnv"
  | "sandboxdArtifactResolver"
  | "sandboxRuntimeProviderResolver"
>;

export type SnapshotWorkflowStepRunner = {
  run: <Output>(
    config: {
      name: string;
    },
    fn: () => Promise<Output> | Output,
  ) => Promise<Output>;
};

export const MaterializeSandboxProfileVersionSnapshotWorkflow = defineTracedDataPlaneWorkflow(
  MaterializeSandboxProfileVersionSnapshotWorkflowSpec,
  async ({
    input: workflowInput,
    run,
    step,
  }): Promise<MaterializeSandboxProfileVersionSnapshotWorkflowOutput> => {
    const ctx = await getWorkflowContext();
    return executeMaterializeSandboxProfileVersionSnapshot({
      ctx,
      workflowInput,
      workflowRunId: run.id,
      step,
    });
  },
);

export async function executeMaterializeSandboxProfileVersionSnapshot(input: {
  ctx: MaterializeSnapshotWorkflowExecutionContext;
  workflowInput: MaterializeSandboxProfileVersionSnapshotWorkflowInput;
  workflowRunId: string;
  step: SnapshotWorkflowStepRunner;
}): Promise<MaterializeSandboxProfileVersionSnapshotWorkflowOutput> {
  const { ctx, workflowInput, workflowRunId, step } = input;
  const logger = ctx.logger.child({
    workflow: MaterializeSandboxProfileVersionSnapshotWorkflowSpec.name,
    workflowRunId,
    snapshotJobId: workflowInput.snapshotJobId,
    sandboxInstanceId: workflowInput.sandboxInstanceId,
    organizationId: workflowInput.organizationId,
    sandboxProfileId: workflowInput.sandboxProfileId,
    sandboxProfileVersion: workflowInput.sandboxProfileVersion,
    runtimeProvider: workflowInput.sandboxRuntime.provider,
  });
  const operationEvents = createWorkerSandboxLifecycleEventRecorder({
    clock: ctx.clock,
    db: ctx.db,
    logger,
    operationId: workflowInput.snapshotJobId,
    operationKind: "snapshot",
    sandboxInstanceId: workflowInput.sandboxInstanceId,
  });
  const requestedRuntimeProvider = workflowInput.sandboxRuntime.provider;
  const sandboxRuntimeInput = {
    organizationId: workflowInput.organizationId,
    provider: requestedRuntimeProvider,
    ...(workflowInput.sandboxRuntime.connectionId === undefined
      ? {}
      : { connectionId: workflowInput.sandboxRuntime.connectionId }),
    ...(workflowInput.sandboxRuntime.resources === undefined
      ? {}
      : { resources: workflowInput.sandboxRuntime.resources }),
  };

  let startedSandboxCleanupState:
    | {
        providerSandboxId: string;
        runtimeProvider: SandboxProvider;
      }
    | undefined;
  let ensuredSandboxInstance = false;
  let sandboxDestroyed = false;
  let currentPhase:
    | "claim"
    | "resolve"
    | "compile"
    | "ensure"
    | "prepare_image"
    | "mark_starting"
    | "start"
    | "persist"
    | "mark_initializing"
    | "init"
    | "mark_running"
    | "capture"
    | "mark_stopping"
    | "destroy"
    | "mark_stopped"
    | "mark_succeeded" = "claim";

  async function handleSnapshotFailure(input: {
    failureCode: string;
    summary: string;
    error: unknown;
  }): Promise<void> {
    const failureMessage = formatPersistedFailureMessage({
      summary: input.summary,
      error: input.error,
    });

    let destroySandboxError: unknown;
    if (startedSandboxCleanupState && !sandboxDestroyed) {
      const { providerSandboxId, runtimeProvider } = startedSandboxCleanupState;
      try {
        await step.run({ name: "destroy-snapshot-sandbox-after-failure" }, async () => {
          const resolvedRuntime =
            await ctx.sandboxRuntimeProviderResolver.resolve(sandboxRuntimeInput);
          await destroySandbox(
            {
              db: ctx.db,
              tables: ctx.tables,
              controlPlaneInternalClient: ctx.controlPlaneInternalClient,
              config: ctx.config,
              sandboxAdapter: resolvedRuntime.sandboxAdapter,
            },
            {
              sandboxInstanceId: workflowInput.sandboxInstanceId,
              organizationId: workflowInput.organizationId,
              persistenceMode: "ephemeral",
              runtimeProvider,
              providerSandboxId,
            },
          );
        });
        sandboxDestroyed = true;
      } catch (error) {
        rethrowDurableStepErrorForRetry(error);

        logger.error(
          {
            err: error,
            snapshotJobId: workflowInput.snapshotJobId,
            providerSandboxId,
          },
          "Failed to destroy snapshot sandbox after workflow failure.",
        );
        destroySandboxError = error;
      }
    }

    let markSandboxInstanceFailedError: unknown;
    if (ensuredSandboxInstance) {
      try {
        await step.run({ name: "mark-snapshot-sandbox-instance-failed" }, async () => {
          await markSandboxInstanceFailed(
            {
              db: ctx.db,
              tables: ctx.tables,
            },
            {
              sandboxInstanceId: workflowInput.sandboxInstanceId,
              failureCode: input.failureCode,
              failureMessage,
              allowRunningCurrentStatus: true,
              allowStoppedCurrentStatus: true,
            },
          );
        });
      } catch (error) {
        rethrowDurableStepErrorForRetry(error);

        logger.error(
          {
            err: error,
            snapshotJobId: workflowInput.snapshotJobId,
            sandboxInstanceId: workflowInput.sandboxInstanceId,
          },
          "Failed to mark snapshot sandbox instance as failed after workflow failure.",
        );
        markSandboxInstanceFailedError = error;
      }
    }

    let markSnapshotJobFailedError: unknown;
    if (currentPhase !== "mark_succeeded") {
      try {
        await step.run({ name: "mark-snapshot-job-failed" }, async () => {
          await ctx.controlPlaneInternalClient.markSandboxProfileVersionSnapshotJobFailed({
            snapshotJobId: workflowInput.snapshotJobId,
            workflowRunId,
            errorCode: input.failureCode,
            errorMessage: failureMessage,
          });
        });
      } catch (error) {
        rethrowDurableStepErrorForRetry(error);

        logger.error(
          {
            err: error,
            snapshotJobId: workflowInput.snapshotJobId,
          },
          "Failed to mark snapshot job as failed after workflow failure.",
        );
        markSnapshotJobFailedError = error;
      }
    }

    if (
      destroySandboxError !== undefined ||
      markSandboxInstanceFailedError !== undefined ||
      markSnapshotJobFailedError !== undefined
    ) {
      throw new Error("Snapshot workflow failure cleanup did not complete successfully.", {
        cause: {
          destroySandboxError,
          markSandboxInstanceFailedError,
          markSnapshotJobFailedError,
        },
      });
    }
  }

  const claimed = await step.run({ name: "claim-snapshot-job" }, async () => {
    try {
      await ctx.controlPlaneInternalClient.claimSandboxProfileVersionSnapshotJob({
        snapshotJobId: workflowInput.snapshotJobId,
        workflowRunId,
      });
      return true;
    } catch (error) {
      if (
        error instanceof ControlPlaneInternalClientRequestError &&
        error.status === 409 &&
        (error.code === "SNAPSHOT_JOB_STATE_CONFLICT" ||
          error.code === "SNAPSHOT_JOB_OWNERSHIP_MISMATCH")
      ) {
        return false;
      }

      throw error;
    }
  });

  if (!claimed) {
    logger.info(
      {
        snapshotJobId: workflowInput.snapshotJobId,
      },
      "Snapshot job claim was not acquired by this workflow run; exiting without work.",
    );
    return {
      snapshotJobId: workflowInput.snapshotJobId,
      sandboxInstanceId: workflowInput.sandboxInstanceId,
      claimed: false,
    };
  }

  try {
    currentPhase = "resolve";
    const resolvedRuntimeProvider = await step.run(
      { name: "resolve-snapshot-sandbox-runtime" },
      async () => {
        const resolvedRuntime =
          await ctx.sandboxRuntimeProviderResolver.resolve(sandboxRuntimeInput);
        return resolvedRuntime.provider;
      },
    );
    if (resolvedRuntimeProvider !== requestedRuntimeProvider) {
      throw new Error(
        "Resolved snapshot sandbox runtime provider did not match requested provider.",
      );
    }

    currentPhase = "compile";
    const compiledRuntimePlan = await step.run(
      { name: "compile-snapshot-runtime-plan" },
      async () => {
        const compileResult =
          await ctx.controlPlaneInternalClient.compileSandboxProfileVersionRuntimePlan({
            organizationId: workflowInput.organizationId,
            profileId: workflowInput.sandboxProfileId,
            profileVersion: workflowInput.sandboxProfileVersion,
            snapshotPreparationScriptKind: workflowInput.snapshotPreparationScriptKind,
            image: {
              imageId: workflowInput.image.imageId,
              kind: workflowInput.image.kind,
            },
          });

        return compileResult.runtimePlan;
      },
    );

    currentPhase = "ensure";
    await step.run({ name: "ensure-snapshot-sandbox-instance" }, async () => {
      await ensureSandboxInstance(
        {
          db: ctx.db,
          tables: ctx.tables,
          sandboxRuntime: workflowInput.sandboxRuntime,
        },
        {
          sandboxInstanceId: workflowInput.sandboxInstanceId,
          organizationId: workflowInput.organizationId,
          sandboxProfileId: workflowInput.sandboxProfileId,
          sandboxProfileVersion: workflowInput.sandboxProfileVersion,
          persistenceMode: "ephemeral",
          purpose: SandboxInstancePurposes.SNAPSHOT,
          startedBy: {
            kind: "system",
            id: workflowInput.snapshotJobId,
          },
          source: SandboxInstanceSources.SYSTEM,
        },
      );
    });
    ensuredSandboxInstance = true;

    currentPhase = "prepare_image";
    const preparedImage = await recordWorkerSandboxLifecyclePhase(
      operationEvents,
      {
        attributes: {
          runtimeProvider: requestedRuntimeProvider,
          snapshotJobId: workflowInput.snapshotJobId,
          timelineKey: "image",
          timelineLabel: "Preparing image",
        },
        completedMessage: "Snapshot sandbox provider image preparation completed.",
        failedMessage: "Snapshot sandbox provider image preparation failed.",
        phase: "provider",
        startedMessage: "Snapshot sandbox provider image preparation started.",
      },
      async () => {
        return step.run({ name: "prepare-snapshot-sandbox-image" }, async () => {
          const resolvedRuntime =
            await ctx.sandboxRuntimeProviderResolver.resolveForImagePreparation(
              sandboxRuntimeInput,
            );

          return prepareSandboxImage(
            {
              sandboxAdapter: resolvedRuntime.sandboxAdapter,
            },
            {
              image: workflowInput.image,
              runtimeProvider: requestedRuntimeProvider,
            },
          );
        });
      },
    );

    currentPhase = "mark_starting";
    await step.run({ name: "mark-snapshot-sandbox-starting" }, async () => {
      await markSandboxInstanceStarting({
        db: ctx.db,
        logger,
        tables: ctx.tables,
        sandboxInstanceId: workflowInput.sandboxInstanceId,
      });
    });

    currentPhase = "start";
    const startedSandbox = await recordWorkerSandboxLifecyclePhase(
      operationEvents,
      {
        attributes: {
          runtimeProvider: requestedRuntimeProvider,
          snapshotJobId: workflowInput.snapshotJobId,
          timelineKey: "sandbox",
          timelineLabel: "Creating sandbox",
          ...(workflowInput.sandboxRuntime.resources === undefined
            ? {}
            : { resources: workflowInput.sandboxRuntime.resources }),
        },
        completedMessage: "Snapshot sandbox provider start completed.",
        failedMessage: "Snapshot sandbox provider start failed.",
        phase: "provider",
        startedMessage: "Snapshot sandbox provider start started.",
      },
      async () => {
        return step.run({ name: "start-snapshot-sandbox" }, async () => {
          const resolvedRuntime =
            await ctx.sandboxRuntimeProviderResolver.resolve(sandboxRuntimeInput);

          return startSandbox(
            {
              config: ctx.config,
              processEnv: ctx.processEnv,
              sandboxAdapter: resolvedRuntime.sandboxAdapter,
            },
            {
              sandboxInstanceId: workflowInput.sandboxInstanceId,
              image: preparedImage,
              runtimeProvider: requestedRuntimeProvider,
              ...(workflowInput.sandboxRuntime.resources === undefined
                ? {}
                : { resources: workflowInput.sandboxRuntime.resources }),
            },
          );
        });
      },
    );
    startedSandboxCleanupState = {
      providerSandboxId: startedSandbox.providerSandboxId,
      runtimeProvider: startedSandbox.runtimeProvider,
    };

    currentPhase = "persist";
    await step.run({ name: "persist-snapshot-sandbox-provisioning" }, async () => {
      await persistSandboxInstanceProvisioning(
        {
          db: ctx.db,
          logger,
          tables: ctx.tables,
        },
        {
          sandboxInstanceId: workflowInput.sandboxInstanceId,
          runtimePlan: compiledRuntimePlan,
          sandboxProfileId: workflowInput.sandboxProfileId,
          sandboxProfileVersion: workflowInput.sandboxProfileVersion,
          providerSandboxId: startedSandbox.providerSandboxId,
        },
      );
    });

    currentPhase = "mark_initializing";
    await step.run({ name: "mark-snapshot-sandbox-initializing" }, async () => {
      await applySandboxLifecycleEvent(
        {
          db: ctx.db,
          logger,
          tables: ctx.tables,
        },
        {
          sandboxInstanceId: workflowInput.sandboxInstanceId,
          event: SandboxLifecycleEvents.PROVIDER_RUNTIME_INITIALIZATION_STARTED,
        },
      );
    });

    currentPhase = "init";
    await step.run({ name: "initialize-snapshot-sandbox-runtime" }, async () => {
      const resolvedRuntime = await ctx.sandboxRuntimeProviderResolver.resolve(sandboxRuntimeInput);

      await initializeSandboxRuntime(
        {
          config: ctx.config,
          logger,
          processEnv: ctx.processEnv,
          sandboxAdapter: resolvedRuntime.sandboxAdapter,
          sandboxdArtifactResolver: ctx.sandboxdArtifactResolver,
          sandboxRuntimeControl: resolvedRuntime.sandboxRuntimeControl,
        },
        {
          organizationId: workflowInput.organizationId,
          operationId: workflowInput.snapshotJobId,
          operationKind: "snapshot",
          sandboxInstanceId: workflowInput.sandboxInstanceId,
          providerSandboxId: startedSandbox.providerSandboxId,
          startupMode: SandboxStartupModes.NEW,
          executionMode: SandboxExecutionModes.SNAPSHOT,
          runtimePlan: compiledRuntimePlan,
        },
      );
    });

    currentPhase = "mark_running";
    await recordWorkerSandboxLifecyclePhase(
      operationEvents,
      {
        attributes: {
          providerSandboxId: startedSandbox.providerSandboxId,
          runtimeProvider: startedSandbox.runtimeProvider,
          snapshotJobId: workflowInput.snapshotJobId,
          timelineHidden: true,
        },
        completedMessage: "Snapshot sandbox running status transition completed.",
        failedMessage: "Snapshot sandbox running status transition failed.",
        phase: "running",
        startedMessage: "Snapshot sandbox running status transition started.",
      },
      async () => {
        await step.run({ name: "mark-snapshot-sandbox-running" }, async () => {
          await markSandboxInstanceRunning(
            {
              db: ctx.db,
              logger,
              tables: ctx.tables,
            },
            {
              sandboxInstanceId: workflowInput.sandboxInstanceId,
            },
          );
        });
      },
    );

    currentPhase = "capture";
    const capturedSnapshot = await recordWorkerSandboxLifecyclePhase(
      operationEvents,
      {
        attributes: {
          providerSandboxId: startedSandbox.providerSandboxId,
          runtimeProvider: startedSandbox.runtimeProvider,
          snapshotJobId: workflowInput.snapshotJobId,
        },
        completedMessage: "Snapshot image capture completed.",
        failedMessage: "Snapshot image capture failed.",
        phase: "snapshot",
        startedMessage: "Snapshot image capture started.",
      },
      async () => {
        const captureResult = await step.run(
          { name: "capture-snapshot-image" },
          async (): Promise<SnapshotCaptureResult> => {
            const resolvedRuntime =
              await ctx.sandboxRuntimeProviderResolver.resolve(sandboxRuntimeInput);

            try {
              const image = await resolvedRuntime.sandboxAdapter.captureSnapshot({
                id: startedSandbox.providerSandboxId,
                providerRequestTimeoutMs: SnapshotProviderRequestTimeoutMs,
              });
              return {
                captured: true,
                image,
              };
            } catch (error) {
              return {
                captured: false,
                errorMessage: error instanceof Error ? error.message : String(error),
              };
            }
          },
        );

        if (!captureResult.captured) {
          throw new Error(captureResult.errorMessage);
        }

        return captureResult.image;
      },
    );

    currentPhase = "mark_stopping";
    await step.run({ name: "mark-snapshot-sandbox-stopping" }, async () => {
      await applySandboxLifecycleEvent(
        {
          db: ctx.db,
          logger,
          tables: ctx.tables,
        },
        {
          sandboxInstanceId: workflowInput.sandboxInstanceId,
          event: SandboxLifecycleEvents.STOP_REQUESTED,
        },
      );
    });

    currentPhase = "destroy";
    await recordWorkerSandboxLifecyclePhase(
      operationEvents,
      {
        attributes: {
          providerSandboxId: startedSandbox.providerSandboxId,
          runtimeProvider: startedSandbox.runtimeProvider,
          snapshotJobId: workflowInput.snapshotJobId,
        },
        completedMessage: "Snapshot sandbox teardown completed.",
        failedMessage: "Snapshot sandbox teardown failed.",
        phase: "teardown",
        startedMessage: "Snapshot sandbox teardown started.",
      },
      async () => {
        await step.run({ name: "destroy-snapshot-sandbox-after-capture" }, async () => {
          const resolvedRuntime =
            await ctx.sandboxRuntimeProviderResolver.resolve(sandboxRuntimeInput);

          await destroySandbox(
            {
              db: ctx.db,
              tables: ctx.tables,
              controlPlaneInternalClient: ctx.controlPlaneInternalClient,
              config: ctx.config,
              sandboxAdapter: resolvedRuntime.sandboxAdapter,
            },
            {
              sandboxInstanceId: workflowInput.sandboxInstanceId,
              organizationId: workflowInput.organizationId,
              persistenceMode: "ephemeral",
              runtimeProvider: startedSandbox.runtimeProvider,
              providerSandboxId: startedSandbox.providerSandboxId,
            },
          );
        });
      },
    );
    sandboxDestroyed = true;

    currentPhase = "mark_stopped";
    await step.run({ name: "mark-snapshot-sandbox-stopped" }, async () => {
      await markSandboxInstanceStopped({
        db: ctx.db,
        tables: ctx.tables,
        sandboxInstanceId: workflowInput.sandboxInstanceId,
        stopReason: SandboxStopReasons.SYSTEM,
      });
    });

    currentPhase = "mark_succeeded";
    await step.run({ name: "mark-snapshot-job-succeeded" }, async () => {
      await ctx.controlPlaneInternalClient.markSandboxProfileVersionSnapshotJobSucceeded({
        snapshotJobId: workflowInput.snapshotJobId,
        workflowRunId,
        image: {
          provider: capturedSnapshot.provider,
          imageId: capturedSnapshot.imageId,
        },
      });
    });

    return {
      snapshotJobId: workflowInput.snapshotJobId,
      sandboxInstanceId: workflowInput.sandboxInstanceId,
      claimed: true,
      image: capturedSnapshot,
    };
  } catch (error) {
    rethrowDurableStepErrorForRetry(error);

    const failure = mapSnapshotFailure({
      phase: currentPhase,
    });

    await handleSnapshotFailure({
      failureCode: failure.failureCode,
      summary: failure.summary,
      error,
    });

    throw new Error(failure.summary, {
      cause: error,
    });
  }
}

function mapSnapshotFailure(input: {
  phase:
    | "claim"
    | "resolve"
    | "compile"
    | "ensure"
    | "prepare_image"
    | "mark_starting"
    | "start"
    | "persist"
    | "mark_initializing"
    | "init"
    | "mark_running"
    | "capture"
    | "mark_stopping"
    | "destroy"
    | "mark_stopped"
    | "mark_succeeded";
}): {
  failureCode: string;
  summary: string;
} {
  if (input.phase === "resolve") {
    return {
      failureCode: SnapshotMaterializationFailureCodes.SANDBOX_RUNTIME_RESOLVE_FAILED,
      summary: "Failed to resolve snapshot sandbox runtime credentials.",
    };
  }

  if (input.phase === "compile") {
    return {
      failureCode: SnapshotMaterializationFailureCodes.RUNTIME_PLAN_COMPILE_FAILED,
      summary: "Failed to compile snapshot runtime plan.",
    };
  }

  if (input.phase === "prepare_image") {
    return {
      failureCode: SnapshotMaterializationFailureCodes.SANDBOX_START_FAILED,
      summary: "Failed to prepare snapshot sandbox image.",
    };
  }

  if (input.phase === "mark_starting") {
    return {
      failureCode: SnapshotMaterializationFailureCodes.STATUS_TRANSITION_TO_STARTING_FAILED,
      summary: "Failed to mark snapshot sandbox instance as starting.",
    };
  }

  if (input.phase === "start") {
    return {
      failureCode: SnapshotMaterializationFailureCodes.SANDBOX_START_FAILED,
      summary: "Failed to start snapshot sandbox.",
    };
  }

  if (input.phase === "persist") {
    return {
      failureCode: SnapshotMaterializationFailureCodes.PERSIST_PROVISIONING_METADATA_FAILED,
      summary: "Failed to persist snapshot sandbox provisioning metadata.",
    };
  }

  if (input.phase === "mark_initializing") {
    return {
      failureCode: SnapshotMaterializationFailureCodes.STATUS_TRANSITION_TO_INITIALIZING_FAILED,
      summary: "Failed to mark snapshot sandbox instance as initializing.",
    };
  }

  if (input.phase === "init") {
    return {
      failureCode: SnapshotMaterializationFailureCodes.SANDBOX_INIT_FAILED,
      summary: "Failed to initialize snapshot sandbox runtime.",
    };
  }

  if (input.phase === "mark_running") {
    return {
      failureCode: SnapshotMaterializationFailureCodes.STATUS_TRANSITION_TO_RUNNING_FAILED,
      summary: "Failed to mark snapshot sandbox instance as running.",
    };
  }

  if (input.phase === "capture") {
    return {
      failureCode: SnapshotMaterializationFailureCodes.SNAPSHOT_CAPTURE_FAILED,
      summary: "Failed to capture snapshot image.",
    };
  }

  if (input.phase === "mark_stopping") {
    return {
      failureCode: SnapshotMaterializationFailureCodes.SANDBOX_DESTROY_FAILED,
      summary: "Failed to mark snapshot sandbox instance as stopping.",
    };
  }

  if (input.phase === "destroy") {
    return {
      failureCode: SnapshotMaterializationFailureCodes.SANDBOX_DESTROY_FAILED,
      summary: "Failed to destroy snapshot sandbox after capture.",
    };
  }

  if (input.phase === "mark_stopped") {
    return {
      failureCode: SnapshotMaterializationFailureCodes.STATUS_TRANSITION_TO_STOPPED_FAILED,
      summary: "Failed to mark snapshot sandbox instance as stopped.",
    };
  }

  return {
    failureCode: SnapshotMaterializationFailureCodes.SANDBOX_INIT_FAILED,
    summary: "Snapshot materialization workflow failed.",
  };
}
