import {
  StopSandboxInstanceWorkflowSpec,
  type StopSandboxInstanceWorkflowInput,
  type StopSandboxInstanceWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";
import { trace } from "@opentelemetry/api";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import { stopSandboxInstance } from "./stop-sandbox-instance.js";

type StopSandboxInstanceServiceInput = Parameters<typeof stopSandboxInstance>[1];

function toStopSandboxInstanceServiceInput(
  input: StopSandboxInstanceWorkflowInput,
): StopSandboxInstanceServiceInput {
  if (input.stopReason === "system") {
    return {
      sandboxInstanceId: input.sandboxInstanceId,
      stopReason: input.stopReason,
    };
  }

  if (input.expectedOwnerLeaseId === undefined) {
    throw new Error("Expected owner lease id is required for idle sandbox stops.");
  }

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    stopReason: input.stopReason,
    expectedOwnerLeaseId: input.expectedOwnerLeaseId,
  };
}

export const StopSandboxInstanceWorkflow = defineTracedDataPlaneWorkflow(
  StopSandboxInstanceWorkflowSpec,
  async ({ input, step }): Promise<StopSandboxInstanceWorkflowOutput> => {
    const ctx = await getWorkflowContext();

    const result = await step.run({ name: "stop-sandbox-instance" }, async () => {
      return stopSandboxInstance(
        {
          config: ctx.config,
          db: ctx.db,
          controlPlaneInternalClient: ctx.controlPlaneInternalClient,
          sandboxAdapter: ctx.sandboxAdapter,
          runtimeStateReader: ctx.runtimeStateReader,
          clock: ctx.clock,
        },
        toStopSandboxInstanceServiceInput(input),
      );
    });

    trace.getActiveSpan()?.addEvent("sandbox_instance_stop.outcome", {
      "mistle.sandbox.instance_id": input.sandboxInstanceId,
      "mistle.sandbox.stop.reason": input.stopReason,
      "mistle.sandbox.stop.executed": result.executed,
      "mistle.sandbox.stop.outcome": result.outcome,
    });
    ctx.logger.info(
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
