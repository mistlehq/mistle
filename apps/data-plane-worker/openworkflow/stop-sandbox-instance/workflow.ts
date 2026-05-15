import {
  StopSandboxInstanceWorkflowSpec,
  type StopSandboxInstanceWorkflowInput,
  type StopSandboxInstanceWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";
import { trace } from "@opentelemetry/api";

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

    await operationEvents.record({
      attributes: {
        executed: result.executed,
        outcome: result.outcome,
        stopReason: input.stopReason,
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
