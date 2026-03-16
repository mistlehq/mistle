import {
  HandleAutomationConversationDeliveryWorkflowSpec,
  HandleAutomationRunWorkflowSpec,
} from "@mistle/workflow-registry/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../../src/openworkflow/context.js";
import {
  prepareAutomationRun,
  resolveAutomationRunFailure,
} from "../../src/runtime/workflows/automation-run.js";
import { setAutomationConversationDeliveryProcessorIdle } from "../../src/runtime/workflows/persistence/set-conversation-delivery-processor-idle.js";
import { markAutomationRunFailed } from "../shared/automation-run.js";
import { handoffAutomationRunDelivery } from "./handoff-automation-run-delivery.js";
import { transitionAutomationRunToRunning } from "./transition-automation-run-to-running.js";

export const HandleAutomationRunWorkflow = defineWorkflow(
  HandleAutomationRunWorkflowSpec,
  async ({ input, step }) => {
    const { db, openWorkflow } = await getWorkflowContext();

    const transitionResult = await step.run(
      { name: "transition-automation-run-to-running" },
      async () =>
        transitionAutomationRunToRunning(
          {
            db,
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
            db,
          },
          input,
        ),
      );

      await step.run({ name: "handoff-automation-run-delivery" }, async () => {
        const deliveryHandoff = await handoffAutomationRunDelivery(
          {
            db,
          },
          {
            preparedAutomationRun,
          },
        );

        if (!deliveryHandoff.shouldStart) {
          return;
        }

        try {
          await openWorkflow.runWorkflow(
            HandleAutomationConversationDeliveryWorkflowSpec,
            {
              conversationId: deliveryHandoff.conversationId,
              generation: deliveryHandoff.generation,
            },
            {
              idempotencyKey: `automation-conversation-delivery:${deliveryHandoff.conversationId}:${String(deliveryHandoff.generation)}`,
            },
          );
        } catch (error) {
          await setAutomationConversationDeliveryProcessorIdle(
            {
              db,
            },
            {
              conversationId: deliveryHandoff.conversationId,
              generation: deliveryHandoff.generation,
            },
          );
          throw error;
        }
      });
    } catch (error) {
      const failure = resolveAutomationRunFailure(error);
      await step.run({ name: "mark-automation-run-failed" }, async () =>
        markAutomationRunFailed(
          {
            db,
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
