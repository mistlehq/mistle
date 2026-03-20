import {
  StopSandboxInstanceWorkflowSpec,
  type StopSandboxInstanceWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../core/context.js";
import { stopSandboxInstance } from "./stop-sandbox-instance.js";

export const StopSandboxInstanceWorkflow = defineWorkflow(
  StopSandboxInstanceWorkflowSpec,
  async ({ input, step }): Promise<StopSandboxInstanceWorkflowOutput> => {
    const ctx = await getWorkflowContext();

    await step.run({ name: "stop-sandbox-instance" }, async () => {
      await stopSandboxInstance(
        {
          config: ctx.config,
          db: ctx.db,
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
