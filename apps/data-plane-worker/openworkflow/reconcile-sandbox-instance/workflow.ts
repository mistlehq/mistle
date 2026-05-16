import {
  ReconcileSandboxInstanceWorkflowSpec,
  type ReconcileSandboxInstanceWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";
import { rethrowDurableStepErrorForRetry } from "@mistle/workflow-registry/durable-step-retry.js";
import { trace } from "@opentelemetry/api";

import {
  SandboxBootstrapAttachmentTerminateOutcomes,
  type TerminateSandboxBootstrapAttachmentResult,
} from "../../runtime-state/sandbox-bootstrap-attachment-terminator.js";
import { getWorkflowContext } from "../core/context.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import {
  reconcileSandboxInstance,
  type ReconcileSandboxInstanceResult,
} from "./reconcile-sandbox-instance.js";

export const ReconcileSandboxInstanceWorkflow = defineTracedDataPlaneWorkflow(
  ReconcileSandboxInstanceWorkflowSpec,
  async ({ input, step }): Promise<ReconcileSandboxInstanceWorkflowOutput> => {
    const ctx = await getWorkflowContext();

    function rethrowReconcileDurableStepErrorForRetry(error: unknown): void {
      rethrowDurableStepErrorForRetry(error, {
        attributes: {
          sandboxInstanceId: input.sandboxInstanceId,
          reason: input.reason,
        },
        eventName: "sandbox_instance.reconcile_step_retry",
        logger: ctx.logger,
        message: "Retrying sandbox reconcile workflow after durable step failure.",
      });
    }

    async function terminateBootstrapAttachmentStep(
      reconcileResult: ReconcileSandboxInstanceResult,
    ): Promise<TerminateSandboxBootstrapAttachmentResult | undefined> {
      const target = reconcileResult.bootstrapAttachmentTerminationTarget;
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
              ...(target.expectedSessionId === undefined
                ? {}
                : { expectedSessionId: target.expectedSessionId }),
            });
          },
        );

        if (
          terminateResult.outcome === SandboxBootstrapAttachmentTerminateOutcomes.FENCE_MISMATCH
        ) {
          ctx.logger.info(
            {
              sandboxInstanceId: input.sandboxInstanceId,
              reason: input.reason,
              expectedOwnerLeaseId: target.expectedOwnerLeaseId,
              ...(target.expectedSessionId === undefined
                ? {}
                : { expectedSessionId: target.expectedSessionId }),
              outcome: terminateResult.outcome,
            },
            "Skipped stale sandbox bootstrap attachment termination after reconcile.",
          );
          return terminateResult;
        }

        ctx.logger.info(
          {
            sandboxInstanceId: input.sandboxInstanceId,
            reason: input.reason,
            expectedOwnerLeaseId: target.expectedOwnerLeaseId,
            ...(target.expectedSessionId === undefined
              ? {}
              : { expectedSessionId: target.expectedSessionId }),
            outcome: terminateResult.outcome,
          },
          "Terminated sandbox bootstrap attachment after reconcile.",
        );
        return terminateResult;
      } catch (error) {
        rethrowReconcileDurableStepErrorForRetry(error);
        throw error;
      }
    }

    let result: ReconcileSandboxInstanceResult;
    try {
      result = await step.run({ name: "reconcile-sandbox-instance" }, async () => {
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
    } catch (error) {
      rethrowReconcileDurableStepErrorForRetry(error);
      throw error;
    }

    const terminationResult = await terminateBootstrapAttachmentStep(result);

    trace.getActiveSpan()?.addEvent("sandbox_instance_reconcile.outcome", {
      "mistle.sandbox.instance_id": input.sandboxInstanceId,
      "mistle.sandbox.reconcile.reason": input.reason,
      "mistle.sandbox.reconcile.executed": result.executed,
      "mistle.sandbox.reconcile.outcome": result.outcome,
      ...(terminationResult === undefined
        ? {}
        : {
            "mistle.sandbox.bootstrap_attachment.termination_outcome": terminationResult.outcome,
          }),
    });
    ctx.logger.info(
      {
        sandboxInstanceId: input.sandboxInstanceId,
        reason: input.reason,
        executed: result.executed,
        outcome: result.outcome,
        ...(terminationResult === undefined
          ? {}
          : { bootstrapAttachmentTerminationOutcome: terminationResult.outcome }),
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
