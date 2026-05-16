import {
  StopSandboxInstanceWorkflowSpec,
  type StopSandboxInstanceWorkflowInput,
  type StopSandboxInstanceWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";
import { rethrowDurableStepErrorForRetry } from "@mistle/workflow-registry/durable-step-retry.js";
import { trace } from "@opentelemetry/api";

import {
  SandboxBootstrapAttachmentTerminateOutcomes,
  type TerminateSandboxBootstrapAttachmentResult,
} from "../../runtime-state/sandbox-bootstrap-attachment-terminator.js";
import { getWorkflowContext } from "../core/context.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import { createWorkerSandboxLifecycleEventRecorder } from "../shared/sandbox-operation-events.js";
import { stopSandboxInstance, type StopSandboxInstanceResult } from "./stop-sandbox-instance.js";

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
      },
      message: "Sandbox stop requested.",
      phase: "stop",
      status: "started",
    });

    let result: StopSandboxInstanceResult;
    function rethrowStopDurableStepErrorForRetry(error: unknown): void {
      rethrowDurableStepErrorForRetry(error, {
        attributes: {
          sandboxInstanceId: input.sandboxInstanceId,
        },
        eventName: "sandbox_instance.stop_step_retry",
        logger,
        message: "Retrying sandbox stop workflow after durable step failure.",
      });
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
      await operationEvents.record({
        attributes: {
          error: formatLifecycleEventError(error),
          stopReason: input.stopReason,
        },
        message: "Sandbox stop failed.",
        phase: "stop",
        status: "failed",
      });
      throw error;
    }

    const terminationResult = await terminateBootstrapAttachmentStep(result);

    await operationEvents.record({
      attributes: {
        executed: result.executed,
        outcome: result.outcome,
        stopReason: input.stopReason,
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
