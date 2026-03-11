import { defineWorkflow, defineWorkflowSpec } from "openworkflow";

import { HandleAutomationConversationDeliveryWorkflow } from "../handle-automation-conversation-delivery/index.js";
import { getControlPlaneWorkflowRuntime } from "../runtime-context.js";
import {
  handoffAutomationRunDelivery,
  markAutomationRunFailed,
  prepareAutomationRun,
  resolveAutomationRunFailure,
  transitionAutomationRunToRunning,
} from "../runtime/index.js";

export type HandleAutomationRunTransitionResult = {
  shouldProcess: boolean;
};

export type PreparedAutomationRun = {
  automationRunId: string;
  automationRunCreatedAt: string;
  automationId: string;
  conversationId: string;
  automationTargetId: string;
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  webhookEventId: string;
  webhookEventType: string;
  webhookProviderEventType: string;
  webhookExternalEventId: string;
  webhookExternalDeliveryId: string | null;
  webhookSourceOrderKey: string;
  webhookPayload: Record<string, unknown>;
  renderedInput: string;
  renderedConversationKey: string;
  renderedIdempotencyKey: string | null;
};

export type HandoffAutomationRunDeliveryInput = {
  preparedAutomationRun: PreparedAutomationRun;
};

export type HandleAutomationRunFailure = {
  code: string;
  message: string;
};

export type MarkAutomationRunFailedInput = {
  automationRunId: string;
  failureCode: string;
  failureMessage: string;
};

export type HandleAutomationRunWorkflowInput = {
  automationRunId: string;
};

export type HandleAutomationRunWorkflowOutput = {
  automationRunId: string;
};

export const HandleAutomationRunWorkflow = defineWorkflow(
  defineWorkflowSpec<HandleAutomationRunWorkflowInput, HandleAutomationRunWorkflowOutput>({
    name: "control-plane.automations.handle-run",
    version: "1",
  }),
  async ({ input: workflowInput, step }) => {
    const runtime = await getControlPlaneWorkflowRuntime();
    const transitionResult = await step.run(
      { name: "transition-automation-run-to-running" },
      async () =>
        transitionAutomationRunToRunning(
          {
            db: runtime.db,
          },
          workflowInput,
        ),
    );
    if (!transitionResult.shouldProcess) {
      return {
        automationRunId: workflowInput.automationRunId,
      };
    }

    try {
      const preparedAutomationRun = await step.run({ name: "prepare-automation-run" }, async () =>
        prepareAutomationRun(
          {
            db: runtime.db,
          },
          workflowInput,
        ),
      );

      await step.run({ name: "handoff-automation-run-delivery" }, async () =>
        handoffAutomationRunDelivery(
          {
            db: runtime.db,
            enqueueConversationDeliveryWorkflow: async (enqueueInput) => {
              await runtime.openWorkflow.runWorkflow(
                HandleAutomationConversationDeliveryWorkflow.spec,
                {
                  conversationId: enqueueInput.conversationId,
                  generation: enqueueInput.generation,
                },
                {
                  idempotencyKey: `automation-conversation-delivery:${enqueueInput.conversationId}:${String(enqueueInput.generation)}`,
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
            db: runtime.db,
          },
          {
            automationRunId: workflowInput.automationRunId,
            failureCode: failure.code,
            failureMessage: failure.message,
          },
        ),
      );
      throw error;
    }

    return {
      automationRunId: workflowInput.automationRunId,
    };
  },
);

export const HandleAutomationRunWorkflowSpec = HandleAutomationRunWorkflow.spec;
