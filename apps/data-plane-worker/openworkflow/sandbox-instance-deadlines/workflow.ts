import {
  HandleSandboxInstanceDeadlineWorkflowSpec,
  type HandleSandboxInstanceDeadlineWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";
import { trace } from "@opentelemetry/api";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import { handleSandboxInstanceDeadline } from "./handle-sandbox-instance-deadline.js";

export const HandleSandboxInstanceDeadlineWorkflow = defineTracedDataPlaneWorkflow(
  HandleSandboxInstanceDeadlineWorkflowSpec,
  async ({ input, step }): Promise<HandleSandboxInstanceDeadlineWorkflowOutput> => {
    const ctx = await getWorkflowContext();

    const result = await step.run({ name: "handle-sandbox-instance-deadline" }, async () => {
      return handleSandboxInstanceDeadline(
        {
          config: ctx.config,
          db: ctx.db,
          tables: ctx.tables,
          controlPlaneInternalClient: ctx.controlPlaneInternalClient,
          sandboxAdapter: ctx.sandboxAdapter,
          runtimeStateReader: ctx.runtimeStateReader,
          clock: ctx.clock,
        },
        {
          sandboxInstanceId: input.sandboxInstanceId,
          kind: input.kind,
          ownerLeaseId: input.ownerLeaseId,
          dueAt: input.dueAt,
          generation: input.generation,
        },
      );
    });

    trace.getActiveSpan()?.addEvent("sandbox_instance_deadline.outcome", {
      "mistle.sandbox.instance_id": result.sandboxInstanceId,
      "mistle.sandbox.deadline.kind": result.kind,
      "mistle.sandbox.deadline.executed": result.executed,
      "mistle.sandbox.deadline.outcome": result.outcome,
    });
    ctx.logger.info(
      {
        sandboxInstanceId: result.sandboxInstanceId,
        kind: result.kind,
        executed: result.executed,
        outcome: result.outcome,
      },
      "Handled sandbox instance deadline workflow.",
    );

    return result;
  },
);
