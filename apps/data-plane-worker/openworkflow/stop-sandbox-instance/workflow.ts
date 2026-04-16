import {
  StopSandboxInstanceWorkflowSpec,
  type StopSandboxInstanceWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import { stopSandboxInstance } from "./stop-sandbox-instance.js";

export const StopSandboxInstanceWorkflow = defineTracedDataPlaneWorkflow(
  StopSandboxInstanceWorkflowSpec,
  async ({ input, step }): Promise<StopSandboxInstanceWorkflowOutput> => {
    const ctx = await getWorkflowContext();

    await step.run({ name: "stop-sandbox-instance" }, async () => {
      await stopSandboxInstance(
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
          stopReason: input.stopReason,
          expectedOwnerLeaseId: input.expectedOwnerLeaseId,
        },
      );
    });

    return {
      sandboxInstanceId: input.sandboxInstanceId,
    };
  },
);
