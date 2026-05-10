import { ControlPlaneInternalClientRequestError } from "@mistle/control-plane-internal-client";
import {
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxStopReasons,
} from "@mistle/db/data-plane";
import { SandboxProvider } from "@mistle/sandbox";
import {
  MaterializeSandboxProfileVersionSnapshotWorkflowSpec,
  type MaterializeSandboxProfileVersionSnapshotWorkflowInput,
  type MaterializeSandboxProfileVersionSnapshotWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";
import { shouldRethrowDurableStepErrorForRetry } from "@mistle/workflow-registry/durable-step-retry.js";

import { getWorkflowContext, type WorkflowContext } from "../core/context.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import { destroySandbox } from "../shared/destroy-sandbox.js";
import { formatPersistedFailureMessage } from "../shared/format-persisted-failure-message.js";
import { ensureSandboxInstance } from "../start-sandbox-instance/ensure-sandbox-instance.js";
import { initializeSandboxRuntime } from "../start-sandbox-instance/initialize-sandbox-runtime.js";
import { markSandboxInstanceFailed } from "../start-sandbox-instance/mark-sandbox-instance-failed.js";
import { markSandboxInstanceRunning } from "../start-sandbox-instance/mark-sandbox-instance-running.js";
import { persistSandboxInstanceProvisioning } from "../start-sandbox-instance/persist-sandbox-instance-provisioning.js";
import {
  SandboxExecutionModes,
  SandboxStartupModes,
} from "../start-sandbox-instance/sandbox-startup-input.js";
import { startSandbox } from "../start-sandbox-instance/start-sandbox.js";
import { markSandboxInstanceStopped } from "../stop-sandbox-instance/mark-sandbox-instance-stopped.js";

const SnapshotMaterializationFailureCodes = {
  RUNTIME_PLAN_COMPILE_FAILED: "snapshot_runtime_plan_compile_failed",
  SANDBOX_START_FAILED: "snapshot_sandbox_start_failed",
  PERSIST_PROVISIONING_METADATA_FAILED: "snapshot_persist_provisioning_metadata_failed",
  SANDBOX_INIT_FAILED: "snapshot_sandbox_init_failed",
  STATUS_TRANSITION_TO_RUNNING_FAILED: "snapshot_status_transition_to_running_failed",
  SNAPSHOT_CAPTURE_FAILED: "snapshot_capture_failed",
  SANDBOX_DESTROY_FAILED: "snapshot_sandbox_destroy_failed",
  STATUS_TRANSITION_TO_STOPPED_FAILED: "snapshot_status_transition_to_stopped_failed",
} as const;

type MaterializeSnapshotWorkflowExecutionContext = Pick<
  WorkflowContext,
  | "config"
  | "controlPlaneInternalClient"
  | "db"
  | "tables"
  | "logger"
  | "processEnv"
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
  const requestedRuntimeProvider = workflowInput.sandboxRuntime.provider;
  const resolvedRuntime = await ctx.sandboxRuntimeProviderResolver.resolve({
    organizationId: workflowInput.organizationId,
    provider: requestedRuntimeProvider,
    ...(workflowInput.sandboxRuntime.connectionId === undefined
      ? {}
      : { connectionId: workflowInput.sandboxRuntime.connectionId }),
    ...(workflowInput.sandboxRuntime.resources === undefined
      ? {}
      : { resources: workflowInput.sandboxRuntime.resources }),
  });

  let providerSandboxId: string | undefined;
  let runtimeProvider: SandboxProvider | undefined;
  let ensuredSandboxInstance = false;
  let sandboxDestroyed = false;
  let currentPhase:
    | "claim"
    | "compile"
    | "ensure"
    | "start"
    | "persist"
    | "init"
    | "mark_running"
    | "capture"
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
    if (
      runtimeProvider !== undefined &&
      providerSandboxId !== undefined &&
      sandboxDestroyed !== true
    ) {
      const runtimeProviderForCleanup = runtimeProvider;
      const providerSandboxIdForCleanup = providerSandboxId;
      try {
        await step.run({ name: "destroy-snapshot-sandbox-after-failure" }, async () => {
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
              runtimeProvider: runtimeProviderForCleanup,
              providerSandboxId: providerSandboxIdForCleanup,
            },
          );
        });
        sandboxDestroyed = true;
      } catch (error) {
        logger.error(
          {
            err: error,
            snapshotJobId: workflowInput.snapshotJobId,
            providerSandboxId: providerSandboxIdForCleanup,
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
    currentPhase = "compile";
    const compiledRuntimePlan = await step.run(
      { name: "compile-snapshot-runtime-plan" },
      async () => {
        const compileResult =
          await ctx.controlPlaneInternalClient.compileSandboxProfileVersionRuntimePlan({
            organizationId: workflowInput.organizationId,
            profileId: workflowInput.sandboxProfileId,
            profileVersion: workflowInput.sandboxProfileVersion,
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

    currentPhase = "start";
    const startedSandbox = await step.run({ name: "start-snapshot-sandbox" }, async () =>
      startSandbox(
        {
          config: ctx.config,
          processEnv: ctx.processEnv,
          sandboxAdapter: resolvedRuntime.sandboxAdapter,
        },
        {
          sandboxInstanceId: workflowInput.sandboxInstanceId,
          image: workflowInput.image,
          runtimeProvider: requestedRuntimeProvider,
        },
      ),
    );
    providerSandboxId = startedSandbox.providerSandboxId;
    runtimeProvider = startedSandbox.runtimeProvider;

    currentPhase = "persist";
    await step.run({ name: "persist-snapshot-sandbox-provisioning" }, async () => {
      await persistSandboxInstanceProvisioning(
        {
          db: ctx.db,
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

    currentPhase = "init";
    await step.run({ name: "initialize-snapshot-sandbox-runtime" }, async () => {
      await initializeSandboxRuntime(
        {
          config: ctx.config,
          processEnv: ctx.processEnv,
          sandboxAdapter: resolvedRuntime.sandboxAdapter,
          sandboxRuntimeControl: resolvedRuntime.sandboxRuntimeControl,
        },
        {
          organizationId: workflowInput.organizationId,
          sandboxInstanceId: workflowInput.sandboxInstanceId,
          providerSandboxId: startedSandbox.providerSandboxId,
          startupMode: SandboxStartupModes.NEW,
          executionMode: SandboxExecutionModes.SNAPSHOT,
          runtimePlan: compiledRuntimePlan,
        },
      );
    });

    currentPhase = "mark_running";
    await step.run({ name: "mark-snapshot-sandbox-running" }, async () => {
      await markSandboxInstanceRunning(
        {
          db: ctx.db,
          tables: ctx.tables,
        },
        {
          sandboxInstanceId: workflowInput.sandboxInstanceId,
        },
      );
    });

    currentPhase = "capture";
    const capturedSnapshot = await step.run({ name: "capture-snapshot-image" }, async () =>
      resolvedRuntime.sandboxAdapter.captureSnapshot({
        id: startedSandbox.providerSandboxId,
      }),
    );

    currentPhase = "destroy";
    await step.run({ name: "destroy-snapshot-sandbox-after-capture" }, async () => {
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
    if (shouldRethrowDurableStepErrorForRetry(error)) {
      throw error;
    }

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
    | "compile"
    | "ensure"
    | "start"
    | "persist"
    | "init"
    | "mark_running"
    | "capture"
    | "destroy"
    | "mark_stopped"
    | "mark_succeeded";
}): {
  failureCode: string;
  summary: string;
} {
  if (input.phase === "compile") {
    return {
      failureCode: SnapshotMaterializationFailureCodes.RUNTIME_PLAN_COMPILE_FAILED,
      summary: "Failed to compile snapshot runtime plan.",
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
