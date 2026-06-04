import { SandboxUsageEventTypes, type SandboxUsageEventType } from "@mistle/db/data-plane";
import {
  isSandboxResourceNotFoundError,
  type SandboxAdapter,
  type SandboxProvider,
} from "@mistle/sandbox";
import { SandboxLifecycleEvents } from "@mistle/sandbox-lifecycle";
import {
  type ResumeSandboxInstanceWorkflowOutput,
  ResumeSandboxInstanceWorkflowSpec,
} from "@mistle/workflow-registry/data-plane";
import {
  type DurableStepRetryOptions,
  resolveDurableStepFinalError,
  rethrowDurableStepErrorForRetry,
} from "@mistle/workflow-registry/durable-step-retry.js";

import { getWorkflowContext } from "../core/context.js";
import { createResolveSandboxRuntimeInput } from "../core/sandbox-runtime-resolver.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import { applySandboxLifecycleEvent } from "../shared/apply-sandbox-lifecycle-event.js";
import { formatPersistedFailureMessage } from "../shared/format-persisted-failure-message.js";
import { markSandboxInstanceStarting } from "../shared/mark-sandbox-instance-starting.js";
import {
  createWorkerSandboxLifecycleEventRecorder,
  recordWorkerSandboxLifecyclePhase,
} from "../shared/sandbox-operation-events.js";
import { emitSandboxStartupDiagnostics } from "../shared/sandbox-startup-diagnostics.js";
import {
  createSandboxUsageEventIdempotencyKey,
  recordWorkerSandboxUsageEvent,
} from "../shared/sandbox-usage-events.js";
import { stopSandbox } from "../shared/stop-sandbox.js";
import { markSandboxInstanceFailed } from "../start-sandbox-instance/mark-sandbox-instance-failed.js";
import { markSandboxInstanceRunning } from "../start-sandbox-instance/mark-sandbox-instance-running.js";
import { resumeSandboxRuntime } from "../start-sandbox-instance/resume-sandbox-runtime.js";
import { waitForSandboxRuntimeReadiness } from "../start-sandbox-instance/wait-for-sandbox-runtime-readiness.js";
import {
  determineExistingProviderResumeAction,
  type ExistingProviderResumeAction,
} from "./provider-resume-inspection-policy.js";
import {
  resolveResumableSandboxInstanceState,
  type ResumableSandboxInstanceState,
} from "./resolve-resumable-sandbox-instance-state.js";
import { resumeSandbox } from "./resume-sandbox.js";

const ResumeSandboxFailureCodes = {
  RESUME_SANDBOX_FAILED: "resume_sandbox_failed",
  SANDBOX_INIT_FAILED: "sandbox_init_failed",
  TUNNEL_CONNECT_ACK_TIMEOUT: "tunnel_connect_ack_timeout",
  TUNNEL_CONNECT_ACK_WAIT_FAILED: "tunnel_connect_ack_wait_failed",
  STATUS_TRANSITION_TO_RUNNING_FAILED: "status_transition_to_running_failed",
} as const;

const ResumeDurableStepRetryOptions: DurableStepRetryOptions = {
  finalizeNonRetryableOriginalError: true,
};

function createResumeWorkflowLogFields(input: {
  sandboxInstanceId: string;
  organizationId?: string | undefined;
  runtimeProvider?: SandboxProvider | undefined;
  providerSandboxId?: string | null | undefined;
  computeGeneration?: number | undefined;
}) {
  return {
    eventName: "sandbox_instance.resume_phase",
    sandboxInstanceId: input.sandboxInstanceId,
    ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
    ...(input.runtimeProvider === undefined ? {} : { runtimeProvider: input.runtimeProvider }),
    ...(input.providerSandboxId === undefined || input.providerSandboxId === null
      ? {}
      : { providerSandboxId: input.providerSandboxId }),
    ...(input.computeGeneration === undefined
      ? {}
      : { computeGeneration: input.computeGeneration }),
  };
}

export const ResumeSandboxInstanceWorkflow = defineTracedDataPlaneWorkflow(
  ResumeSandboxInstanceWorkflowSpec,
  async ({ input, run, step }): Promise<ResumeSandboxInstanceWorkflowOutput> => {
    const ctx = await getWorkflowContext();
    const logger = ctx.logger.child({
      workflow: ResumeSandboxInstanceWorkflowSpec.name,
      workflowRunId: run.id,
      sandboxInstanceId: input.sandboxInstanceId,
    });
    const operationEvents = createWorkerSandboxLifecycleEventRecorder({
      clock: ctx.clock,
      db: ctx.db,
      logger,
      operationId: run.id,
      operationKind: "resume",
      sandboxInstanceId: input.sandboxInstanceId,
    });

    function rethrowResumeDurableStepErrorForRetry(error: unknown): void {
      rethrowDurableStepErrorForRetry(
        error,
        {
          attributes: {
            sandboxInstanceId: input.sandboxInstanceId,
          },
          eventName: "sandbox_instance.resume_step_retry",
          logger,
          message: "Retrying sandbox resume workflow after durable step failure.",
        },
        ResumeDurableStepRetryOptions,
      );
    }

    async function markResumeFailed(failureCode: string, error: unknown): Promise<void> {
      const failureMessage = formatPersistedFailureMessage({
        summary: "Failed to resume sandbox runtime.",
        error,
      });
      logger.warn(
        {
          failureCode,
          failureMessage,
        },
        "Marking sandbox instance as failed during resume workflow.",
      );
      await step.run({ name: "mark-sandbox-instance-failed-after-resume-failure" }, async () => {
        await markSandboxInstanceFailed(
          {
            db: ctx.db,
            tables: ctx.tables,
          },
          {
            sandboxInstanceId: input.sandboxInstanceId,
            failureCode,
            failureMessage,
          },
        );
      });
    }

    async function stopProviderAfterResumeFailure(providerInput: {
      runtimeProvider: SandboxProvider;
      providerSandboxId: string;
    }): Promise<unknown> {
      try {
        await step.run({ name: "stop-sandbox-after-resume-failure" }, async () => {
          await stopSandbox(
            {
              sandboxAdapter: resolvedRuntime.sandboxAdapter,
              sandboxRuntimeControl: resolvedRuntime.sandboxRuntimeControl,
            },
            {
              runtimeProvider: providerInput.runtimeProvider,
              providerSandboxId: providerInput.providerSandboxId,
              sandboxInstanceId: input.sandboxInstanceId,
            },
          );
        });
        return undefined;
      } catch (error) {
        if (isRecoverableMissingSandboxError(error)) {
          return undefined;
        }
        logger.error({ err: error }, "Failed to stop sandbox after resume failure.");
        return error;
      }
    }

    async function handleResumeFailure(failureInput: {
      failureCode: string;
      error: unknown;
      runtimeProvider: SandboxProvider;
      providerSandboxId: string;
      summary: string;
    }): Promise<void> {
      const failureMessage = formatPersistedFailureMessage({
        summary: failureInput.summary,
        error: failureInput.error,
      });
      const stopSandboxError = await stopProviderAfterResumeFailure({
        runtimeProvider: failureInput.runtimeProvider,
        providerSandboxId: failureInput.providerSandboxId,
      });
      let markFailedError: unknown;
      logger.warn(
        {
          failureCode: failureInput.failureCode,
          failureMessage,
        },
        "Marking sandbox instance as failed during resume workflow.",
      );
      try {
        await step.run({ name: "mark-sandbox-instance-failed-after-resume-failure" }, async () => {
          await markSandboxInstanceFailed(
            {
              db: ctx.db,
              tables: ctx.tables,
            },
            {
              sandboxInstanceId: input.sandboxInstanceId,
              failureCode: failureInput.failureCode,
              failureMessage,
            },
          );
        });
      } catch (error) {
        logger.error({ err: error }, "Failed to mark sandbox instance as failed after resume.");
        markFailedError = error;
      }
      throwResumeFailureHandlingErrors({
        stopSandboxError,
        markFailedError,
      });
    }

    async function recordResumeSandboxUsageEvent(eventInput: {
      eventType: SandboxUsageEventType;
      providerSandboxId: string;
      computeGeneration: number;
      discriminator?: string;
      payload?: Record<string, unknown>;
      state: ResumableSandboxInstanceState;
    }): Promise<void> {
      await recordWorkerSandboxUsageEvent(
        {
          clock: ctx.clock,
          db: ctx.db,
          tables: ctx.tables,
        },
        {
          idempotencyKey: createSandboxUsageEventIdempotencyKey({
            sandboxInstanceId: eventInput.state.sandboxInstanceId,
            computeGeneration: eventInput.computeGeneration,
            eventType: eventInput.eventType,
            operationId: run.id,
            ...(eventInput.discriminator === undefined
              ? {}
              : { discriminator: eventInput.discriminator }),
          }),
          organizationId: eventInput.state.organizationId,
          sandboxInstanceId: eventInput.state.sandboxInstanceId,
          computeGeneration: eventInput.computeGeneration,
          eventType: eventInput.eventType,
          runtimeProvider: eventInput.state.runtimeProvider,
          providerSandboxId: eventInput.providerSandboxId,
          vcpuCount: eventInput.state.sandboxVcpuCount,
          memoryMb: eventInput.state.sandboxMemoryMb,
          diskMb: eventInput.state.sandboxDiskMb,
          payload: {
            workflowRunId: run.id,
            operationKind: "resume",
            ...(eventInput.payload ?? {}),
          },
        },
      );
    }

    logger.info(
      createResumeWorkflowLogFields({
        sandboxInstanceId: input.sandboxInstanceId,
      }),
      "Starting sandbox instance resume workflow.",
    );

    const resumableSandboxState = await step.run(
      { name: "resolve-resumable-sandbox-instance-state" },
      async () =>
        resolveResumableSandboxInstanceState({
          db: ctx.db,
          tables: ctx.tables,
          sandboxInstanceId: input.sandboxInstanceId,
        }),
    );

    if (resumableSandboxState === null) {
      logger.info(
        createResumeWorkflowLogFields({
          sandboxInstanceId: input.sandboxInstanceId,
        }),
        "Skipping sandbox instance resume workflow because sandbox is already active.",
      );
      return {
        sandboxInstanceId: input.sandboxInstanceId,
      };
    }

    const resolvedRuntime = await ctx.sandboxRuntimeProviderResolver.resolve(
      createResolveSandboxRuntimeInput(resumableSandboxState),
    );
    const existingProviderSandboxId = resumableSandboxState.providerSandboxId;

    logger.info(
      createResumeWorkflowLogFields({
        sandboxInstanceId: input.sandboxInstanceId,
        organizationId: resumableSandboxState.organizationId,
        runtimeProvider: resumableSandboxState.runtimeProvider,
        providerSandboxId: existingProviderSandboxId,
        computeGeneration: resumableSandboxState.computeGeneration,
      }),
      "Resolved resumable sandbox instance state.",
    );

    await step.run({ name: "mark-sandbox-instance-starting" }, async () => {
      await markSandboxInstanceStarting({
        db: ctx.db,
        logger,
        tables: ctx.tables,
        sandboxInstanceId: input.sandboxInstanceId,
      });
    });

    let existingProviderResumeAction: ExistingProviderResumeAction;
    try {
      existingProviderResumeAction = await step.run(
        { name: "inspect-existing-sandbox-compute-before-resume" },
        async () =>
          inspectExistingProviderResumeAction(
            {
              sandboxAdapter: resolvedRuntime.sandboxAdapter,
            },
            {
              providerSandboxId: existingProviderSandboxId,
            },
          ),
      );
    } catch (error) {
      rethrowResumeDurableStepErrorForRetry(error);
      await operationEvents.record({
        attributes: {
          providerSandboxId: existingProviderSandboxId,
          runtimeProvider: resumableSandboxState.runtimeProvider,
          error,
        },
        message: "Sandbox provider resume preflight failed.",
        phase: "provider",
        status: "failed",
      });
      await handleResumeFailure({
        failureCode: ResumeSandboxFailureCodes.RESUME_SANDBOX_FAILED,
        error,
        runtimeProvider: resumableSandboxState.runtimeProvider,
        providerSandboxId: existingProviderSandboxId,
        summary: "Failed to inspect sandbox provider runtime before resume.",
      });
      throw resolveDurableStepFinalError(error, ResumeDurableStepRetryOptions);
    }

    if (existingProviderResumeAction.kind === "fail") {
      const error = new Error(existingProviderResumeAction.failureMessage);
      await operationEvents.record({
        attributes: {
          providerSandboxId: existingProviderSandboxId,
          runtimeProvider: resumableSandboxState.runtimeProvider,
          failureCode: existingProviderResumeAction.failureCode,
          error: existingProviderResumeAction.failureMessage,
        },
        message: "Sandbox provider resume preflight failed.",
        phase: "provider",
        status: "failed",
      });
      await markResumeFailed(existingProviderResumeAction.failureCode, error);
      throw error;
    }

    const shouldResumeProvider = existingProviderResumeAction.kind === "resume_provider";
    const providerResumeAttributes = {
      providerSandboxId: existingProviderSandboxId,
      runtimeProvider: resumableSandboxState.runtimeProvider,
      timelineKey: "sandbox",
      timelineLabel: shouldResumeProvider ? "Resuming sandbox" : "Reconnecting sandbox",
    };
    const resumeState = resumableSandboxState;

    async function resumeExistingSandboxCompute(): Promise<{
      sandboxInstanceId: string;
      runtimeProvider: SandboxProvider;
      providerSandboxId: string;
    }> {
      try {
        return await recordWorkerSandboxLifecyclePhase(
          operationEvents,
          {
            attributes: providerResumeAttributes,
            completedMessage: shouldResumeProvider
              ? "Sandbox provider resume completed."
              : "Sandbox provider resume skipped because provider compute is already active.",
            failedMessage: "Sandbox provider resume failed.",
            phase: "provider",
            startedMessage: shouldResumeProvider
              ? "Sandbox provider resume started."
              : "Sandbox provider resume skipped because provider compute is already active.",
          },
          async () =>
            step.run({ name: "resume-existing-sandbox-compute" }, async () => {
              if (!shouldResumeProvider) {
                return {
                  sandboxInstanceId: resumeState.sandboxInstanceId,
                  runtimeProvider: resumeState.runtimeProvider,
                  providerSandboxId: existingProviderSandboxId,
                };
              }

              return await resumeSandbox(
                {
                  config: ctx.config,
                  processEnv: ctx.processEnv,
                  sandboxAdapter: resolvedRuntime.sandboxAdapter,
                },
                {
                  sandboxInstanceId: resumeState.sandboxInstanceId,
                  runtimeProvider: resumeState.runtimeProvider,
                  providerSandboxId: existingProviderSandboxId,
                },
              );
            }),
        );
      } catch (error) {
        rethrowResumeDurableStepErrorForRetry(error);
        await handleResumeFailure({
          failureCode: ResumeSandboxFailureCodes.RESUME_SANDBOX_FAILED,
          error,
          runtimeProvider: resumeState.runtimeProvider,
          providerSandboxId: existingProviderSandboxId,
          summary: "Failed to resume sandbox provider runtime.",
        });
        throw resolveDurableStepFinalError(error, ResumeDurableStepRetryOptions);
      }
    }

    const resumedRuntime = await resumeExistingSandboxCompute();

    await step.run({ name: "mark-resumed-sandbox-instance-started" }, async () => {
      await applySandboxLifecycleEvent(
        {
          db: ctx.db,
          logger,
          tables: ctx.tables,
        },
        {
          sandboxInstanceId: input.sandboxInstanceId,
          event: SandboxLifecycleEvents.PROVIDER_START_ACCEPTED,
        },
      );
    });

    await step.run({ name: "record-sandbox-resumed-usage-event" }, async () => {
      await recordResumeSandboxUsageEvent({
        eventType: SandboxUsageEventTypes.SANDBOX_RESUMED,
        providerSandboxId: resumedRuntime.providerSandboxId,
        computeGeneration: resumableSandboxState.computeGeneration,
        state: resumableSandboxState,
      });
    });

    try {
      await step.run({ name: "mark-resumed-sandbox-instance-initializing" }, async () => {
        await applySandboxLifecycleEvent(
          {
            db: ctx.db,
            logger,
            tables: ctx.tables,
          },
          {
            sandboxInstanceId: input.sandboxInstanceId,
            event: SandboxLifecycleEvents.PROVIDER_RUNTIME_INITIALIZATION_STARTED,
          },
        );
      });

      logger.info(
        createResumeWorkflowLogFields({
          sandboxInstanceId: input.sandboxInstanceId,
          organizationId: resumableSandboxState.organizationId,
          runtimeProvider: resumedRuntime.runtimeProvider,
          providerSandboxId: resumedRuntime.providerSandboxId,
          computeGeneration: resumableSandboxState.computeGeneration,
        }),
        "Initializing resumed sandbox runtime.",
      );
      await step.run({ name: "initialize-resumed-sandbox-runtime" }, async () => {
        await resumeSandboxRuntime(
          {
            config: ctx.config,
            logger,
            processEnv: ctx.processEnv,
            sandboxAdapter: resolvedRuntime.sandboxAdapter,
            sandboxdArtifactResolver: ctx.sandboxdArtifactResolver,
            sandboxRuntimeControl: resolvedRuntime.sandboxRuntimeControl,
          },
          {
            organizationId: resumableSandboxState.organizationId,
            operationId: run.id,
            operationKind: "resume",
            sandboxInstanceId: resumedRuntime.sandboxInstanceId,
            providerSandboxId: resumedRuntime.providerSandboxId,
            runtimeProvider: resumedRuntime.runtimeProvider,
            runtimePlan: resumableSandboxState.runtimePlan,
            ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
            ...(input.gitIdentity === undefined ? {} : { gitIdentity: input.gitIdentity }),
          },
        );
      });
      logger.info(
        createResumeWorkflowLogFields({
          sandboxInstanceId: input.sandboxInstanceId,
          organizationId: resumableSandboxState.organizationId,
          runtimeProvider: resumedRuntime.runtimeProvider,
          providerSandboxId: resumedRuntime.providerSandboxId,
          computeGeneration: resumableSandboxState.computeGeneration,
        }),
        "Initialized resumed sandbox runtime.",
      );
    } catch (error) {
      rethrowResumeDurableStepErrorForRetry(error);
      await emitSandboxStartupDiagnostics({
        logger,
        sandboxRuntimeControl: resolvedRuntime.sandboxRuntimeControl,
        providerSandboxId: resumedRuntime.providerSandboxId,
        sandboxInstanceId: resumedRuntime.sandboxInstanceId,
        runtimeProvider: resumedRuntime.runtimeProvider,
        operation: "activate",
        operationKind: "resume",
      });
      await handleResumeFailure({
        failureCode: ResumeSandboxFailureCodes.SANDBOX_INIT_FAILED,
        error,
        runtimeProvider: resumedRuntime.runtimeProvider,
        providerSandboxId: resumedRuntime.providerSandboxId,
        summary: "Failed to initialize resumed sandbox runtime.",
      });
      throw resolveDurableStepFinalError(error, ResumeDurableStepRetryOptions);
    }

    let resumedSandboxRuntimeReady: boolean;
    try {
      const readinessAttributes = {
        providerSandboxId: resumedRuntime.providerSandboxId,
        runtimeProvider: resumedRuntime.runtimeProvider,
      };
      await operationEvents.record({
        attributes: readinessAttributes,
        message: "Resumed sandbox runtime readiness wait started.",
        phase: "ready",
        status: "started",
      });
      resumedSandboxRuntimeReady = await step.run(
        { name: "wait-for-resumed-sandbox-runtime-readiness" },
        async () =>
          waitForSandboxRuntimeReadiness(
            {
              runtimeStateReader: ctx.runtimeStateReader,
              policy: ctx.tunnelReadinessPolicy,
              clock: ctx.clock,
              sleeper: ctx.sleeper,
            },
            {
              sandboxInstanceId: input.sandboxInstanceId,
            },
          ),
      );
      await operationEvents.record({
        attributes: readinessAttributes,
        message: resumedSandboxRuntimeReady
          ? "Resumed sandbox runtime readiness wait completed."
          : "Resumed sandbox runtime readiness timed out.",
        phase: "ready",
        status: resumedSandboxRuntimeReady ? "completed" : "failed",
      });
    } catch (error) {
      rethrowResumeDurableStepErrorForRetry(error);
      await handleResumeFailure({
        failureCode: ResumeSandboxFailureCodes.TUNNEL_CONNECT_ACK_WAIT_FAILED,
        error,
        runtimeProvider: resumedRuntime.runtimeProvider,
        providerSandboxId: resumedRuntime.providerSandboxId,
        summary: "Failed while waiting for resumed sandbox runtime readiness.",
      });
      throw resolveDurableStepFinalError(error, ResumeDurableStepRetryOptions);
    }

    if (!resumedSandboxRuntimeReady) {
      const error = new Error("Timed out waiting for resumed sandbox runtime readiness.");
      await handleResumeFailure({
        failureCode: ResumeSandboxFailureCodes.TUNNEL_CONNECT_ACK_TIMEOUT,
        error,
        runtimeProvider: resumedRuntime.runtimeProvider,
        providerSandboxId: resumedRuntime.providerSandboxId,
        summary: error.message,
      });
      throw error;
    }

    try {
      await recordWorkerSandboxLifecyclePhase(
        operationEvents,
        {
          attributes: {
            providerSandboxId: resumedRuntime.providerSandboxId,
            runtimeProvider: resumedRuntime.runtimeProvider,
            timelineHidden: true,
          },
          completedMessage: "Resumed sandbox running status transition completed.",
          failedMessage: "Resumed sandbox running status transition failed.",
          phase: "running",
          startedMessage: "Resumed sandbox running status transition started.",
        },
        async () => {
          await step.run({ name: "mark-resumed-sandbox-instance-running" }, async () => {
            await markSandboxInstanceRunning(
              {
                db: ctx.db,
                tables: ctx.tables,
              },
              {
                sandboxInstanceId: input.sandboxInstanceId,
              },
            );
          });
        },
      );
      await emitSandboxStartupDiagnostics({
        logger,
        sandboxRuntimeControl: resolvedRuntime.sandboxRuntimeControl,
        providerSandboxId: resumedRuntime.providerSandboxId,
        sandboxInstanceId: resumedRuntime.sandboxInstanceId,
        runtimeProvider: resumedRuntime.runtimeProvider,
        operation: "activate",
        operationKind: "resume",
      });
    } catch (error) {
      rethrowResumeDurableStepErrorForRetry(error);
      await handleResumeFailure({
        failureCode: ResumeSandboxFailureCodes.STATUS_TRANSITION_TO_RUNNING_FAILED,
        error,
        runtimeProvider: resumedRuntime.runtimeProvider,
        providerSandboxId: resumedRuntime.providerSandboxId,
        summary: "Failed to mark resumed sandbox instance as running.",
      });
      throw resolveDurableStepFinalError(error, ResumeDurableStepRetryOptions);
    }

    await step.run({ name: "record-sandbox-ready-usage-event-after-resume" }, async () => {
      await recordResumeSandboxUsageEvent({
        eventType: SandboxUsageEventTypes.SANDBOX_READY,
        providerSandboxId: resumedRuntime.providerSandboxId,
        computeGeneration: resumableSandboxState.computeGeneration,
        discriminator: "ready",
        state: resumableSandboxState,
      });
    });

    logger.info(
      createResumeWorkflowLogFields({
        sandboxInstanceId: input.sandboxInstanceId,
        organizationId: resumableSandboxState.organizationId,
        runtimeProvider: resumedRuntime.runtimeProvider,
        providerSandboxId: resumedRuntime.providerSandboxId,
        computeGeneration: resumableSandboxState.computeGeneration,
      }),
      "Sandbox resume workflow completed successfully.",
    );

    return {
      sandboxInstanceId: input.sandboxInstanceId,
    };
  },
);

async function inspectExistingProviderResumeAction(
  ctx: {
    sandboxAdapter: SandboxAdapter;
  },
  input: {
    providerSandboxId: string;
  },
): Promise<ExistingProviderResumeAction> {
  try {
    const inspectedSandbox = await ctx.sandboxAdapter.inspect({
      id: input.providerSandboxId,
    });
    return determineExistingProviderResumeAction({
      providerState: inspectedSandbox.disposition,
    });
  } catch (error) {
    if (isRecoverableMissingSandboxError(error)) {
      return determineExistingProviderResumeAction({
        providerState: "missing",
      });
    }
    throw error;
  }
}

function isRecoverableMissingSandboxError(error: unknown): boolean {
  return isSandboxResourceNotFoundError(error);
}

function throwResumeFailureHandlingErrors(input: {
  stopSandboxError?: unknown;
  markFailedError?: unknown;
}): void {
  if (input.stopSandboxError !== undefined || input.markFailedError !== undefined) {
    throw new AggregateError(
      [input.stopSandboxError, input.markFailedError].filter((error) => error !== undefined),
      "Resume failure handling failed.",
    );
  }
}
