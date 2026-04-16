import {
  ReconcileSandboxInstanceWorkflowSpec,
  type ReconcileSandboxInstanceWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import { reconcileSandboxInstance } from "./reconcile-sandbox-instance.js";

export const ReconcileSandboxInstanceWorkflow = defineTracedDataPlaneWorkflow(
  ReconcileSandboxInstanceWorkflowSpec,
  async ({ input, step }): Promise<ReconcileSandboxInstanceWorkflowOutput> => {
    const ctx = await getWorkflowContext();

    await step.run({ name: "reconcile-sandbox-instance" }, async () => {
      await reconcileSandboxInstance(
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
          reason: input.reason,
          expectedOwnerLeaseId: input.expectedOwnerLeaseId,
        },
      );
    });

    return {
      sandboxInstanceId: input.sandboxInstanceId,
    };
  },
);
