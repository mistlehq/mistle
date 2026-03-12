import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "./context.js";
import type { HandleAutomationConversationDeliveryWorkflowInput } from "./handle-automation-conversation-delivery/types.js";
import { HandleAutomationConversationDeliveryWorkflow } from "./handle-automation-conversation-delivery/workflow.js";
import {
  handoffAutomationRunDelivery,
  markAutomationRunFailed,
  prepareAutomationRun,
  resolveAutomationRunFailure,
  transitionAutomationRunToRunning,
} from "./shared/automation/index.js";

export type HandleAutomationRunWorkflowInput = {
  automationRunId: string;
};

export type HandleAutomationRunWorkflowOutput = {
  automationRunId: string;
};

export const HandleAutomationRunWorkflow = defineWorkflow<
  HandleAutomationRunWorkflowInput,
  HandleAutomationRunWorkflowOutput
>(
  {
    name: "control-plane.automations.handle-run",
    version: "1",
  },
  async ({ input, step }) => {
    const ctx = await getWorkflowContext();

    const transitionResult = await step.run(
      { name: "transition-automation-run-to-running" },
      async () =>
        transitionAutomationRunToRunning(
          {
            db: ctx.db,
          },
          input,
        ),
    );

    if (!transitionResult.shouldProcess) {
      return {
        automationRunId: input.automationRunId,
      };
    }

    try {
      const preparedAutomationRun = await step.run({ name: "prepare-automation-run" }, async () =>
        prepareAutomationRun(
          {
            db: ctx.db,
          },
          input,
        ),
      );

      await step.run({ name: "handoff-automation-run-delivery" }, async () =>
        handoffAutomationRunDelivery(
          {
            db: ctx.db,
            enqueueConversationDeliveryWorkflow: async (
              workflowInput: HandleAutomationConversationDeliveryWorkflowInput,
            ) => {
              await ctx.openWorkflow.runWorkflow(
                HandleAutomationConversationDeliveryWorkflow.spec,
                workflowInput,
                {
                  idempotencyKey: `automation-conversation-delivery:${workflowInput.conversationId}:${String(workflowInput.generation)}`,
                },
              );
            },
          },
          {
            preparedAutomationRun,
          },
        ),
      );
    } catch (error) {
      const failure = resolveAutomationRunFailure(error);

      await step.run({ name: "mark-automation-run-failed" }, async () =>
        markAutomationRunFailed(
          {
            db: ctx.db,
          },
          {
            automationRunId: input.automationRunId,
            failureCode: failure.code,
            failureMessage: failure.message,
          },
        ),
      );

      throw error;
    }

    return {
      automationRunId: input.automationRunId,
    };
  },
);
