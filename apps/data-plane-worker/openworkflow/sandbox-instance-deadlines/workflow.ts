import {
  HandleSandboxInstanceDeadlineWorkflowSpec,
  type HandleSandboxInstanceDeadlineWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import { handleSandboxInstanceDeadline } from "./handle-sandbox-instance-deadline.js";

export const HandleSandboxInstanceDeadlineWorkflow = defineTracedDataPlaneWorkflow(
  HandleSandboxInstanceDeadlineWorkflowSpec,
  async ({ input, step }): Promise<HandleSandboxInstanceDeadlineWorkflowOutput> => {
    const ctx = await getWorkflowContext();

    return step.run({ name: "handle-sandbox-instance-deadline" }, async () => {
      return handleSandboxInstanceDeadline(
        {
          config: ctx.config,
          db: ctx.db,
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
  },
);
