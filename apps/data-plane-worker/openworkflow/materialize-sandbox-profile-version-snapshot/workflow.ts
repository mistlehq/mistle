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
import type { RetryPolicy } from "openworkflow";

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
import { activateSandboxRuntime } from "../start-sandbox-instance/initialize-sandbox-runtime.js";
import { markSandboxInstanceFailed } from "../start-sandbox-instance/mark-sandbox-instance-failed.js";
import { markSandboxInstanceRunning } from "../start-sandbox-instance/mark-sandbox-instance-running.js";
import { persistSandboxInstanceProvisioning } from "../start-sandbox-instance/persist-sandbox-instance-provisioning.js";
import { prepareSandboxImage, startSandbox } from "../start-sandbox-instance/start-sandbox.js";
import { markSandboxInstanceStopped } from "../stop-sandbox-instance/mark-sandbox-instance-stopped.js";

const SnapshotMaterializationFailureCodes = {
  RUNTIME_PLAN_COMPILE_FAILED: "snapshot_runtime_plan_compile_failed",
  RUNTIME_PLAN_KIND_MISMATCH: "snapshot_runtime_plan_kind_mismatch",
  RUNTIME_PLAN_INVALID_BINDING_CONFIG: "snapshot_runtime_plan_invalid_binding_config",
  RUNTIME_PLAN_INVALID_TARGET_CONFIG: "snapshot_runtime_plan_invalid_target_config",
  RUNTIME_PLAN_INVALID_TARGET_SECRETS: "snapshot_runtime_plan_invalid_target_secrets",
  RUNTIME_PLAN_CONNECTION_MISMATCH: "snapshot_runtime_plan_connection_mismatch",
  RUNTIME_PLAN_CONNECTION_NOT_ACTIVE: "snapshot_runtime_plan_connection_not_active",
  RUNTIME_PLAN_TARGET_DISABLED: "snapshot_runtime_plan_target_disabled",
  RUNTIME_PLAN_INVALID_BINDING_CONNECTION_REFERENCE:
    "snapshot_runtime_plan_invalid_binding_connection_reference",
  RUNTIME_PLAN_INVALID_CONNECTION_TARGET_REFERENCE:
    "snapshot_runtime_plan_invalid_connection_target_reference",
  RUNTIME_PLAN_ROUTE_CONFLICT: "snapshot_runtime_plan_route_conflict",
  RUNTIME_PLAN_ARTIFACT_CONFLICT: "snapshot_runtime_plan_artifact_conflict",
  RUNTIME_PLAN_RUNTIME_CLIENT_SETUP_CONFLICT: "snapshot_runtime_plan_runtime_client_setup_conflict",
  RUNTIME_PLAN_RUNTIME_CLIENT_SETUP_INVALID_REF:
    "snapshot_runtime_plan_runtime_client_setup_invalid_ref",
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
export const SnapshotProviderRequestTimeoutMs = 60 * 60 * 1000;
export const SnapshotActivationStepRetryPolicy = {
  maximumAttempts: 1,
} satisfies Partial<RetryPolicy>;
export const SnapshotFailureCleanupStepRetryPolicy = {
  maximumAttempts: 1,
} satisfies Partial<RetryPolicy>;

type SnapshotCaptureResult =
  | {
      captured: true;
      image: SandboxImageHandle;
    }
  | {
      captured: false;
      errorMessage: string;
    };

type SnapshotMaterializationFailure = {
  detailMessage?: string;
  failureCode: string;
  summary: string;
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
      retryPolicy?: Partial<RetryPolicy>;
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
        await step.run(
          {
            name: "destroy-snapshot-sandbox-after-failure",
            retryPolicy: SnapshotFailureCleanupStepRetryPolicy,
          },
          async () => {
            const resolvedRuntime =
              await ctx.sandboxRuntimeProviderResolver.resolve(sandboxRuntimeInput);
            await destroySandbox(
              {
                sandboxAdapter: resolvedRuntime.sandboxAdapter,
              },
              {
                runtimeProvider,
                providerSandboxId,
              },
            );
          },
        );
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
        await step.run(
          {
            name: "mark-snapshot-sandbox-instance-failed",
            retryPolicy: SnapshotFailureCleanupStepRetryPolicy,
          },
          async () => {
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
          },
        );
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
        await step.run(
          {
            name: "mark-snapshot-job-failed",
            retryPolicy: SnapshotFailureCleanupStepRetryPolicy,
          },
          async () => {
            await ctx.controlPlaneInternalClient.markSandboxProfileVersionSnapshotJobFailed({
              snapshotJobId: workflowInput.snapshotJobId,
              workflowRunId,
              errorCode: input.failureCode,
              errorMessage: failureMessage,
            });
          },
        );
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

    currentPhase = "compile";
    const compiledRuntimePlan = await recordWorkerSandboxLifecyclePhase(
      operationEvents,
      {
        attributes: {
          runtimeProvider: requestedRuntimeProvider,
          snapshotJobId: workflowInput.snapshotJobId,
          timelineKey: "compile",
          timelineLabel: "Compiling runtime plan",
        },
        completedMessage: "Snapshot runtime plan compile completed.",
        failedMessage: "Snapshot runtime plan compile failed.",
        phase: "runtime_plan",
        startedMessage: "Snapshot runtime plan compile started.",
      },
      async () => {
        return step.run({ name: "compile-snapshot-runtime-plan" }, async () => {
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
        });
      },
    );

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
    await step.run(
      {
        name: "initialize-snapshot-sandbox-runtime",
        retryPolicy: SnapshotActivationStepRetryPolicy,
      },
      async () => {
        const resolvedRuntime =
          await ctx.sandboxRuntimeProviderResolver.resolve(sandboxRuntimeInput);

        await activateSandboxRuntime(
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
            runtimePlan: compiledRuntimePlan,
          },
        );
      },
    );

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
              sandboxAdapter: resolvedRuntime.sandboxAdapter,
            },
            {
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

    const failure =
      currentPhase === "compile"
        ? (mapCompileSnapshotFailure(error) ??
          mapSnapshotFailure({
            phase: currentPhase,
          }))
        : mapSnapshotFailure({
            phase: currentPhase,
          });

    await handleSnapshotFailure({
      failureCode: failure.failureCode,
      summary: failure.summary,
      error: failure.detailMessage === undefined ? error : failure.detailMessage,
    });

    throw new Error(failure.summary, {
      cause: error,
    });
  }
}

function mapCompileSnapshotFailure(error: unknown): SnapshotMaterializationFailure | null {
  if (!(error instanceof ControlPlaneInternalClientRequestError)) {
    return null;
  }

  if (error.status !== 400 || error.code === undefined) {
    return null;
  }

  const detailMessage = removeInternalCompileFailurePrefix(error.message);
  const failureCode = resolveSnapshotRuntimePlanFailureCode(error.code);
  if (failureCode === null) {
    return null;
  }

  return {
    detailMessage,
    failureCode,
    summary: resolveSnapshotRuntimePlanFailureSummary({
      code: error.code,
      integrationLabel: resolveCompileFailureIntegrationLabel(detailMessage),
    }),
  };
}

function removeInternalCompileFailurePrefix(message: string): string {
  return message.replace(
    /^Control-plane internal runtime plan compile failed with status 400:\s*/u,
    "",
  );
}

function resolveSnapshotRuntimePlanFailureCode(code: string): string | null {
  switch (code) {
    case "INVALID_BINDING_CONNECTION_REFERENCE":
      return SnapshotMaterializationFailureCodes.RUNTIME_PLAN_INVALID_BINDING_CONNECTION_REFERENCE;
    case "INVALID_CONNECTION_TARGET_REFERENCE":
      return SnapshotMaterializationFailureCodes.RUNTIME_PLAN_INVALID_CONNECTION_TARGET_REFERENCE;
    case "CONNECTION_MISMATCH":
      return SnapshotMaterializationFailureCodes.RUNTIME_PLAN_CONNECTION_MISMATCH;
    case "TARGET_DISABLED":
      return SnapshotMaterializationFailureCodes.RUNTIME_PLAN_TARGET_DISABLED;
    case "CONNECTION_NOT_ACTIVE":
      return SnapshotMaterializationFailureCodes.RUNTIME_PLAN_CONNECTION_NOT_ACTIVE;
    case "KIND_MISMATCH":
      return SnapshotMaterializationFailureCodes.RUNTIME_PLAN_KIND_MISMATCH;
    case "INVALID_TARGET_CONFIG":
      return SnapshotMaterializationFailureCodes.RUNTIME_PLAN_INVALID_TARGET_CONFIG;
    case "INVALID_TARGET_SECRETS":
      return SnapshotMaterializationFailureCodes.RUNTIME_PLAN_INVALID_TARGET_SECRETS;
    case "INVALID_BINDING_CONFIG":
      return SnapshotMaterializationFailureCodes.RUNTIME_PLAN_INVALID_BINDING_CONFIG;
    case "ROUTE_CONFLICT":
      return SnapshotMaterializationFailureCodes.RUNTIME_PLAN_ROUTE_CONFLICT;
    case "ARTIFACT_CONFLICT":
      return SnapshotMaterializationFailureCodes.RUNTIME_PLAN_ARTIFACT_CONFLICT;
    case "RUNTIME_CLIENT_SETUP_CONFLICT":
      return SnapshotMaterializationFailureCodes.RUNTIME_PLAN_RUNTIME_CLIENT_SETUP_CONFLICT;
    case "RUNTIME_CLIENT_SETUP_INVALID_REF":
      return SnapshotMaterializationFailureCodes.RUNTIME_PLAN_RUNTIME_CLIENT_SETUP_INVALID_REF;
    default:
      return null;
  }
}

function resolveCompileFailureIntegrationLabel(message: string): string | null {
  const definitionMatch = /'([a-z0-9-]+)::[a-z0-9-]+'/iu.exec(message);
  if (definitionMatch?.[1] !== undefined) {
    return formatIntegrationLabel(definitionMatch[1]);
  }

  const routeMatch = /egress[_-]([a-z0-9-]+)/iu.exec(message);
  if (routeMatch?.[1] !== undefined) {
    return formatIntegrationLabel(routeMatch[1]);
  }

  const runtimeServerMatch = /MCP server id '([a-z0-9-]+)'/iu.exec(message);
  if (runtimeServerMatch?.[1] !== undefined) {
    return formatIntegrationLabel(runtimeServerMatch[1]);
  }

  return null;
}

function formatIntegrationLabel(value: string): string {
  const normalizedValue = value.trim().toLowerCase();
  switch (normalizedValue) {
    case "aws":
      return "AWS";
    case "gcp":
      return "Google Cloud";
    case "github":
      return "GitHub";
    case "google":
      return "Google";
    case "googleads":
      return "Google Ads";
    case "google-analytics":
      return "Google Analytics";
    case "google-business-profile":
      return "Google Business Profile";
    case "google-search-console":
      return "Google Search Console";
    case "google-workspace":
      return "Google Workspace";
    case "linear":
      return "Linear";
    case "openai":
      return "OpenAI";
    case "wasenderapi":
      return "WasenderAPI";
    default:
      return normalizedValue
        .split("-")
        .map((part) => {
          if (part.length === 0) {
            return part;
          }

          return `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`;
        })
        .join(" ");
  }
}

function labelOrFallback(input: { integrationLabel: string | null; fallback: string }): string {
  return input.integrationLabel ?? input.fallback;
}

function resolveSnapshotRuntimePlanFailureSummary(input: {
  code: string;
  integrationLabel: string | null;
}): string {
  const integration = labelOrFallback({
    integrationLabel: input.integrationLabel,
    fallback: "an integration",
  });

  switch (input.code) {
    case "INVALID_BINDING_CONNECTION_REFERENCE":
      return `Snapshot creation failed because ${integration} is missing its connection. Reconnect ${integration}, then retry snapshot creation.`;
    case "INVALID_CONNECTION_TARGET_REFERENCE":
      return `Snapshot creation failed because ${integration} could not be found. Check that ${integration} is still available, then retry snapshot creation.`;
    case "CONNECTION_MISMATCH":
      return `Snapshot creation failed because ${integration} is connected to the wrong profile or organization. Review the ${integration} connection, then retry snapshot creation.`;
    case "TARGET_DISABLED":
      return `Snapshot creation failed because ${integration} is currently disabled. Enable ${integration}, then retry snapshot creation.`;
    case "CONNECTION_NOT_ACTIVE":
      return `Snapshot creation failed because ${integration} is no longer connected. Reconnect ${integration}, then retry snapshot creation.`;
    case "KIND_MISMATCH":
      return `Snapshot creation failed because ${integration} is configured with the wrong type. Update the ${integration} binding, then retry snapshot creation.`;
    case "INVALID_TARGET_CONFIG":
      return `Snapshot creation failed because ${integration} has incomplete setup. Review the ${integration} settings, then retry snapshot creation.`;
    case "INVALID_TARGET_SECRETS":
      return `Snapshot creation failed because ${integration}'s saved credentials could not be used. Reconnect ${integration} or update its credentials, then retry snapshot creation.`;
    case "INVALID_BINDING_CONFIG":
      return `Snapshot creation failed because ${integration} has incomplete setup. Review the ${integration} binding settings, then retry snapshot creation.`;
    case "ROUTE_CONFLICT":
      return input.integrationLabel === null
        ? "Snapshot creation failed because two integrations are trying to use the same network access rule. Review the enabled integrations, then retry snapshot creation."
        : `Snapshot creation failed because ${integration} has a network access conflict. Review the ${integration} integration settings, then retry snapshot creation.`;
    case "ARTIFACT_CONFLICT":
      return input.integrationLabel === null
        ? "Snapshot creation failed because two integrations are trying to install the same runtime file. Review the enabled integrations, then retry snapshot creation."
        : `Snapshot creation failed because ${integration} conflicts with another integration during setup. Review the enabled integrations, then retry snapshot creation.`;
    case "RUNTIME_CLIENT_SETUP_CONFLICT":
      return input.integrationLabel === null
        ? "Snapshot creation failed because two integrations are configuring the agent in conflicting ways. Review the enabled integrations, then retry snapshot creation."
        : `Snapshot creation failed because ${integration} conflicts with another integration in the agent setup. Review the enabled integrations, then retry snapshot creation.`;
    case "RUNTIME_CLIENT_SETUP_INVALID_REF":
      return `Snapshot creation failed because ${integration} references setup that is not available. Review the ${integration} integration setup, then retry snapshot creation.`;
    default:
      return "Failed to compile snapshot runtime plan.";
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
}): SnapshotMaterializationFailure {
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
