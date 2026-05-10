import {
  ReconcileSandboxInstanceWorkflowSpec,
  type ReconcileSandboxInstanceWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";
import { trace } from "@opentelemetry/api";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import { reconcileSandboxInstance } from "./reconcile-sandbox-instance.js";

export const ReconcileSandboxInstanceWorkflow = defineTracedDataPlaneWorkflow(
  ReconcileSandboxInstanceWorkflowSpec,
  async ({ input, step }): Promise<ReconcileSandboxInstanceWorkflowOutput> => {
    const ctx = await getWorkflowContext();

    const result = await step.run({ name: "reconcile-sandbox-instance" }, async () => {
      return reconcileSandboxInstance(
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
          reason: input.reason,
          expectedOwnerLeaseId: input.expectedOwnerLeaseId,
        },
      );
    });

    trace.getActiveSpan()?.addEvent("sandbox_instance_reconcile.outcome", {
      "mistle.sandbox.instance_id": input.sandboxInstanceId,
      "mistle.sandbox.reconcile.reason": input.reason,
      "mistle.sandbox.reconcile.executed": result.executed,
      "mistle.sandbox.reconcile.outcome": result.outcome,
    });
    ctx.logger.info(
      {
        sandboxInstanceId: input.sandboxInstanceId,
        reason: input.reason,
        executed: result.executed,
        outcome: result.outcome,
      },
      "Handled sandbox instance reconcile workflow.",
    );

    return {
      sandboxInstanceId: input.sandboxInstanceId,
      executed: result.executed,
      outcome: result.outcome,
    };
  },
);
