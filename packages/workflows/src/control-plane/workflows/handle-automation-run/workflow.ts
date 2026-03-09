import type { ConversationProviderFamily } from "@mistle/db/control-plane";
import { defineWorkflow, type Workflow } from "openworkflow";

import {
  HandleAutomationRunWorkflowSpec,
  type HandleAutomationRunWorkflowInput,
  type HandleAutomationRunWorkflowOutput,
} from "./spec.js";

export type HandleAutomationRunTransitionResult = {
  shouldProcess: boolean;
};

export type PreparedAutomationRun = {
  automationRunId: string;
  automationRunCreatedAt: string;
  automationId: string;
  automationTargetId: string;
  organizationId: string;
  sandboxProfileId: string;
  webhookEventId: string;
  webhookEventType: string;
  webhookProviderEventType: string;
  webhookExternalEventId: string;
  webhookExternalDeliveryId: string | null;
  webhookPayload: Record<string, unknown>;
  sourceOccurredAt: string | null;
  sourceOrderKey: string;
  providerFamily: ConversationProviderFamily;
  renderedInput: string;
  renderedConversationKey: string;
  renderedIdempotencyKey: string | null;
};

export type EnqueuePreparedAutomationRunInput = {
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

export type CreateHandleAutomationRunWorkflowInput = {
  transitionAutomationRunToRunning: (
    input: HandleAutomationRunWorkflowInput,
  ) => Promise<HandleAutomationRunTransitionResult>;
  prepareAutomationRun: (input: HandleAutomationRunWorkflowInput) => Promise<PreparedAutomationRun>;
  enqueuePreparedAutomationRun: (input: EnqueuePreparedAutomationRunInput) => Promise<void>;
  markAutomationRunFailed: (input: MarkAutomationRunFailedInput) => Promise<void>;
  resolveAutomationRunFailure: (input: { error: unknown }) => HandleAutomationRunFailure;
};

export function createHandleAutomationRunWorkflow(
  ctx: CreateHandleAutomationRunWorkflowInput,
): Workflow<
  HandleAutomationRunWorkflowInput,
  HandleAutomationRunWorkflowOutput,
  HandleAutomationRunWorkflowInput
> {
  return defineWorkflow(HandleAutomationRunWorkflowSpec, async ({ input: workflowInput, step }) => {
    const transitionResult = await step.run(
      { name: "transition-automation-run-to-running" },
      async () => ctx.transitionAutomationRunToRunning(workflowInput),
    );
    if (!transitionResult.shouldProcess) {
      return {
        automationRunId: workflowInput.automationRunId,
      };
    }

    try {
      const preparedAutomationRun = await step.run({ name: "prepare-automation-run" }, async () =>
        ctx.prepareAutomationRun(workflowInput),
      );

      await step.run({ name: "enqueue-prepared-automation-run" }, async () =>
        ctx.enqueuePreparedAutomationRun({
          preparedAutomationRun,
        }),
      );
    } catch (error) {
      const failure = ctx.resolveAutomationRunFailure({
        error,
      });
      await step.run({ name: "mark-automation-run-failed" }, async () =>
        ctx.markAutomationRunFailed({
          automationRunId: workflowInput.automationRunId,
          failureCode: failure.code,
          failureMessage: failure.message,
        }),
      );
      throw error;
    }

    return {
      automationRunId: workflowInput.automationRunId,
    };
  });
}
