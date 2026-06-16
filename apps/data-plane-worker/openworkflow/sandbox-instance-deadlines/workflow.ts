import {
  HandleSandboxInstanceDeadlineWorkflowSpec,
  type HandleSandboxInstanceDeadlineWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";
import { trace } from "@opentelemetry/api";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import { createWorkerSandboxLifecycleEventRecorder } from "../shared/sandbox-operation-events.js";
import { handleSandboxInstanceDeadline } from "./handle-sandbox-instance-deadline.js";

export const HandleSandboxInstanceDeadlineWorkflow = defineTracedDataPlaneWorkflow(
  HandleSandboxInstanceDeadlineWorkflowSpec,
  async ({ input, run, step }): Promise<HandleSandboxInstanceDeadlineWorkflowOutput> => {
    const ctx = await getWorkflowContext();
    const logger = ctx.logger.child({
      workflow: HandleSandboxInstanceDeadlineWorkflowSpec.name,
      workflowRunId: run.id,
      sandboxInstanceId: input.sandboxInstanceId,
      deadlineKind: input.kind,
    });
    const operationEvents = createWorkerSandboxLifecycleEventRecorder({
      clock: ctx.clock,
      db: ctx.db,
      logger,
      operationId: run.id,
      operationKind: "deadline",
      sandboxInstanceId: input.sandboxInstanceId,
    });

    await operationEvents.record({
      attributes: {
        deadlineDueAt: input.dueAt,
        deadlineGeneration: input.generation,
        deadlineKind: input.kind,
        ownerLeaseId: input.ownerLeaseId,
        timelineKey: "deadline",
        timelineLabel: "Evaluating sandbox deadline",
      },
      message: "Sandbox deadline evaluation started.",
      phase: "deadline",
      status: "started",
    });

    const result = await step.run({ name: "handle-sandbox-instance-deadline" }, async () => {
      return handleSandboxInstanceDeadline(
        {
          config: ctx.config,
          db: ctx.db,
          tables: ctx.tables,
          controlPlaneInternalClient: ctx.controlPlaneInternalClient,
          sandboxRuntimeProviderResolver: ctx.sandboxRuntimeProviderResolver,
          runtimeStateReader: ctx.runtimeStateReader,
          clock: ctx.clock,
          operationEvents,
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

    await operationEvents.record({
      attributes: {
        deadlineDueAt: input.dueAt,
        deadlineGeneration: input.generation,
        deadlineKind: input.kind,
        executed: result.executed,
        outcome: result.outcome,
        ownerLeaseId: input.ownerLeaseId,
        timelineKey: "deadline",
        timelineLabel: "Evaluating sandbox deadline",
      },
      message: "Sandbox deadline evaluation completed.",
      phase: "deadline",
      status: result.executed ? "completed" : "warning",
    });

    trace.getActiveSpan()?.addEvent("sandbox_instance_deadline.outcome", {
      "mistle.sandbox.instance_id": result.sandboxInstanceId,
      "mistle.sandbox.deadline.kind": result.kind,
      "mistle.sandbox.deadline.executed": result.executed,
      "mistle.sandbox.deadline.outcome": result.outcome,
    });
    logger.info(
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
