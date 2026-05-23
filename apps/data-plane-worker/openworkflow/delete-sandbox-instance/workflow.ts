import { SandboxUsageEventTypes } from "@mistle/db/data-plane";
import {
  DeleteSandboxInstanceWorkflowSpec,
  type DeleteSandboxInstanceWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";
import { rethrowDurableStepErrorForRetry } from "@mistle/workflow-registry/durable-step-retry.js";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import {
  createSandboxUsageEventIdempotencyKey,
  recordWorkerSandboxUsageEvent,
} from "../shared/sandbox-usage-events.js";
import { deleteSandboxInstance } from "./delete-sandbox-instance.js";

export const DeleteSandboxInstanceWorkflow = defineTracedDataPlaneWorkflow(
  DeleteSandboxInstanceWorkflowSpec,
  async ({ input, run, step }): Promise<DeleteSandboxInstanceWorkflowOutput> => {
    const ctx = await getWorkflowContext();
    const logger = ctx.logger.child({
      workflow: DeleteSandboxInstanceWorkflowSpec.name,
      workflowRunId: run.id,
      sandboxInstanceId: input.sandboxInstanceId,
    });

    try {
      const result = await step.run({ name: "delete-sandbox-instance" }, async () => {
        return deleteSandboxInstance(
          {
            config: ctx.config,
            db: ctx.db,
            tables: ctx.tables,
            controlPlaneInternalClient: ctx.controlPlaneInternalClient,
            sandboxRuntimeProviderResolver: ctx.sandboxRuntimeProviderResolver,
          },
          {
            sandboxInstanceId: input.sandboxInstanceId,
          },
        );
      });

      if (result.executed && result.usageEventState !== undefined) {
        const usageEventState = result.usageEventState;
        await step.run({ name: "record-sandbox-deleted-usage-event" }, async () => {
          await recordWorkerSandboxUsageEvent(
            {
              clock: ctx.clock,
              db: ctx.db,
              tables: ctx.tables,
            },
            {
              idempotencyKey: createSandboxUsageEventIdempotencyKey({
                sandboxInstanceId: input.sandboxInstanceId,
                computeGeneration: usageEventState.computeGeneration,
                eventType: SandboxUsageEventTypes.SANDBOX_STOPPED,
                operationId: run.id,
              }),
              organizationId: usageEventState.organizationId,
              sandboxInstanceId: input.sandboxInstanceId,
              computeGeneration: usageEventState.computeGeneration,
              eventType: SandboxUsageEventTypes.SANDBOX_STOPPED,
              runtimeProvider: usageEventState.runtimeProvider,
              providerSandboxId: usageEventState.providerSandboxId,
              storageProvider: null,
              providerStorageId: null,
              vcpuCount: usageEventState.vcpuCount,
              memoryMb: usageEventState.memoryMb,
              storageMb: usageEventState.storageMb,
              payload: {
                workflowRunId: run.id,
                operationKind: "delete",
                outcome: result.outcome,
              },
            },
          );
        });
      }

      return {
        sandboxInstanceId: result.sandboxInstanceId,
        executed: result.executed,
        outcome: result.outcome,
      };
    } catch (error) {
      rethrowDurableStepErrorForRetry(error, {
        attributes: {
          sandboxInstanceId: input.sandboxInstanceId,
        },
        eventName: "sandbox_instance.delete_step_retry",
        logger,
        message: "Retrying sandbox delete workflow after durable step failure.",
      });
      throw error;
    }
  },
);
