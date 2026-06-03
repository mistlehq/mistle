import { SandboxUsageEventTypes } from "@mistle/db/data-plane";
import {
  StopSandboxInstanceWorkflowSpec,
  type StopSandboxInstanceWorkflowInput,
  type StopSandboxInstanceWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";
import {
  type DurableStepRetryOptions,
  resolveDurableStepFinalError,
  rethrowDurableStepErrorForRetry,
} from "@mistle/workflow-registry/durable-step-retry.js";
import { trace } from "@opentelemetry/api";

import {
  SandboxBootstrapAttachmentTerminateOutcomes,
  type TerminateSandboxBootstrapAttachmentResult,
} from "../../runtime-state/sandbox-bootstrap-attachment-terminator.js";
import { getWorkflowContext } from "../core/context.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import { createWorkerSandboxLifecycleEventRecorder } from "../shared/sandbox-operation-events.js";
import {
  createSandboxUsageEventIdempotencyKey,
  recordWorkerSandboxUsageEvent,
} from "../shared/sandbox-usage-events.js";
import { stopSandboxInstance, type StopSandboxInstanceResult } from "./stop-sandbox-instance.js";

const StopDurableStepRetryOptions: DurableStepRetryOptions = {
  finalizeNonRetryableOriginalError: true,
};

function resolveExpectedOwnerLeaseId(input: StopSandboxInstanceWorkflowInput): {
  expectedOwnerLeaseId?: string;
} {
  if (input.stopReason !== "idle") {
    return {};
  }

  return {
    expectedOwnerLeaseId: input.expectedOwnerLeaseId,
  };
}

export const StopSandboxInstanceWorkflow = defineTracedDataPlaneWorkflow(
  StopSandboxInstanceWorkflowSpec,
  async ({ input, run, step }): Promise<StopSandboxInstanceWorkflowOutput> => {
    const ctx = await getWorkflowContext();
    const logger = ctx.logger.child({
      workflow: StopSandboxInstanceWorkflowSpec.name,
      workflowRunId: run.id,
      sandboxInstanceId: input.sandboxInstanceId,
      stopReason: input.stopReason,
    });
    const operationEvents = createWorkerSandboxLifecycleEventRecorder({
      clock: ctx.clock,
      db: ctx.db,
      logger,
      operationId: run.id,
      operationKind: "stop",
      sandboxInstanceId: input.sandboxInstanceId,
    });

    await operationEvents.record({
      attributes: {
        stopReason: input.stopReason,
        timelineKey: "stop",
        timelineLabel: "Stopping sandbox",
      },
      message: "Sandbox stop requested.",
      phase: "stop",
      status: "started",
    });

    let result: StopSandboxInstanceResult;
    function rethrowStopDurableStepErrorForRetry(error: unknown): void {
      rethrowDurableStepErrorForRetry(
        error,
        {
          attributes: {
            sandboxInstanceId: input.sandboxInstanceId,
          },
          eventName: "sandbox_instance.stop_step_retry",
          logger,
          message: "Retrying sandbox stop workflow after durable step failure.",
        },
        StopDurableStepRetryOptions,
      );
    }

    async function terminateBootstrapAttachmentStep(
      stopResult: StopSandboxInstanceResult,
    ): Promise<TerminateSandboxBootstrapAttachmentResult | undefined> {
      const target = stopResult.bootstrapAttachmentTerminationTarget;
      if (target === undefined) {
        return undefined;
      }

      try {
        const terminateResult = await step.run(
          { name: "terminate-bootstrap-attachment" },
          async () => {
            return ctx.bootstrapAttachmentTerminator.terminate({
              sandboxInstanceId: input.sandboxInstanceId,
              expectedOwnerLeaseId: target.expectedOwnerLeaseId,
              expectedSessionId: target.expectedSessionId,
            });
          },
        );

        if (
          terminateResult.outcome === SandboxBootstrapAttachmentTerminateOutcomes.FENCE_MISMATCH
        ) {
          logger.info(
            {
              sandboxInstanceId: input.sandboxInstanceId,
              expectedOwnerLeaseId: target.expectedOwnerLeaseId,
              expectedSessionId: target.expectedSessionId,
              outcome: terminateResult.outcome,
            },
            "Skipped stale sandbox bootstrap attachment termination.",
          );
          return terminateResult;
        }

        logger.info(
          {
            sandboxInstanceId: input.sandboxInstanceId,
            expectedOwnerLeaseId: target.expectedOwnerLeaseId,
            expectedSessionId: target.expectedSessionId,
            outcome: terminateResult.outcome,
          },
          "Terminated sandbox bootstrap attachment after stop.",
        );
        return terminateResult;
      } catch (error) {
        rethrowStopDurableStepErrorForRetry(error);
        await operationEvents.record({
          attributes: {
            error: formatLifecycleEventError(error),
            stopReason: input.stopReason,
            timelineKey: "stop",
            timelineLabel: "Stopping sandbox",
          },
          message: "Sandbox bootstrap attachment termination failed.",
          phase: "stop",
          status: "failed",
        });
        throw error;
      }
    }

    try {
      result = await step.run({ name: "stop-sandbox-instance" }, async () => {
        return stopSandboxInstance(
          {
            config: ctx.config,
            db: ctx.db,
            tables: ctx.tables,
            controlPlaneInternalClient: ctx.controlPlaneInternalClient,
            sandboxRuntimeProviderResolver: ctx.sandboxRuntimeProviderResolver,
            runtimeStateReader: ctx.runtimeStateReader,
            clock: ctx.clock,
            logger,
          },
          {
            sandboxInstanceId: input.sandboxInstanceId,
            stopReason: input.stopReason,
            ...resolveExpectedOwnerLeaseId(input),
          },
        );
      });
    } catch (error) {
      rethrowStopDurableStepErrorForRetry(error);
      const finalError = resolveDurableStepFinalError(error, StopDurableStepRetryOptions);
      await operationEvents.record({
        attributes: {
          error: formatLifecycleEventError(finalError),
          stopReason: input.stopReason,
          timelineKey: "stop",
          timelineLabel: "Stopping sandbox",
        },
        message: "Sandbox stop failed.",
        phase: "stop",
        status: "failed",
      });
      throw finalError;
    }

    if (result.executed && result.usageEventState !== undefined) {
      const usageEventState = result.usageEventState;
      const usageEventType =
        result.outcome === "failed"
          ? SandboxUsageEventTypes.SANDBOX_FAILED
          : SandboxUsageEventTypes.SANDBOX_STOPPED;
      await step.run({ name: "record-sandbox-terminal-usage-event" }, async () => {
        await recordWorkerSandboxUsageEvent(
          {
            clock: ctx.clock,
            db: ctx.db,
            tables: ctx.tables,
          },
          {
            idempotencyKey: createSandboxUsageEventIdempotencyKey({
              sandboxInstanceId: input.sandboxInstanceId,
              computeGeneration: usageEventState.computeGeneration,
              eventType: usageEventType,
              operationId: run.id,
            }),
            organizationId: usageEventState.organizationId,
            sandboxInstanceId: input.sandboxInstanceId,
            computeGeneration: usageEventState.computeGeneration,
            eventType: usageEventType,
            runtimeProvider: usageEventState.runtimeProvider,
            providerSandboxId: usageEventState.providerSandboxId,
            vcpuCount: usageEventState.vcpuCount,
            memoryMb: usageEventState.memoryMb,
            storageMb: usageEventState.storageMb,
            payload: {
              workflowRunId: run.id,
              operationKind: "stop",
              stopReason: input.stopReason,
              outcome: result.outcome,
            },
          },
        );
      });
    }

    const terminationResult = await terminateBootstrapAttachmentStep(result);

    if (result.outcome === "failed") {
      const terminalFailure = result.terminalFailure;
      const failureMessage =
        terminalFailure === undefined
          ? "Sandbox stop failed."
          : `${terminalFailure.failureCode}: ${terminalFailure.failureMessage}`;
      await operationEvents.record({
        attributes: {
          error: failureMessage,
          executed: result.executed,
          outcome: result.outcome,
          stopReason: input.stopReason,
          timelineKey: "stop",
          timelineLabel: "Stopping sandbox",
          ...(terminationResult === undefined
            ? {}
            : { bootstrapAttachmentTerminationOutcome: terminationResult.outcome }),
        },
        message: "Sandbox stop failed.",
        phase: "stop",
        status: "failed",
      });
      throw new Error(failureMessage);
    }

    await operationEvents.record({
      attributes: {
        executed: result.executed,
        outcome: result.outcome,
        stopReason: input.stopReason,
        timelineKey: "stop",
        timelineLabel: "Stopping sandbox",
        ...(terminationResult === undefined
          ? {}
          : { bootstrapAttachmentTerminationOutcome: terminationResult.outcome }),
      },
      message: resolveStopCompletedMessage(result),
      phase: "stop",
      status: "completed",
    });

    trace.getActiveSpan()?.addEvent("sandbox_instance_stop.outcome", {
      "mistle.sandbox.instance_id": input.sandboxInstanceId,
      "mistle.sandbox.stop.reason": input.stopReason,
      "mistle.sandbox.stop.executed": result.executed,
      "mistle.sandbox.stop.outcome": result.outcome,
    });
    logger.info(
      {
        sandboxInstanceId: input.sandboxInstanceId,
        stopReason: input.stopReason,
        executed: result.executed,
        outcome: result.outcome,
        ...(terminationResult === undefined
          ? {}
          : { bootstrapAttachmentTerminationOutcome: terminationResult.outcome }),
      },
      "Handled sandbox instance stop workflow.",
    );

    return {
      sandboxInstanceId: input.sandboxInstanceId,
      executed: result.executed,
      outcome: result.outcome,
    };
  },
);

function resolveStopCompletedMessage(result: StopSandboxInstanceResult): string {
  if (result.executed) {
    return "Sandbox stop completed.";
  }

  if (result.outcome === "already_stopped") {
    return "Sandbox was already stopped.";
  }

  return "Sandbox stop skipped.";
}

function formatLifecycleEventError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
