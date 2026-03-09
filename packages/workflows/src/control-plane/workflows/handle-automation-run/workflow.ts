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
  sandboxProfileVersion: number;
  webhookEventId: string;
  webhookEventType: string;
  webhookProviderEventType: string;
  webhookExternalEventId: string;
  webhookExternalDeliveryId: string | null;
  webhookPayload: Record<string, unknown>;
  renderedInput: string;
  renderedConversationKey: string;
  renderedIdempotencyKey: string | null;
};

export type EnsureAutomationSandboxInput = {
  preparedAutomationRun: PreparedAutomationRun;
};

export type ClaimAutomationConversationInput = {
  preparedAutomationRun: PreparedAutomationRun;
};

export type ClaimedAutomationConversation = {
  conversationId: string;
};

export type EnsuredAutomationSandbox = {
  sandboxInstanceId: string;
  startupWorkflowRunId: string;
};

export type AcquiredAutomationConnection = {
  instanceId: string;
  url: string;
  token: string;
  expiresAt: string;
};

export type AcquireAutomationConnectionInput = {
  preparedAutomationRun: PreparedAutomationRun;
  ensuredAutomationSandbox: EnsuredAutomationSandbox;
};

export type DeliverAutomationPayloadInput = {
  preparedAutomationRun: PreparedAutomationRun;
  ensuredAutomationSandbox: EnsuredAutomationSandbox;
  acquiredAutomationConnection: AcquiredAutomationConnection;
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
  claimAutomationConversation: (
    input: ClaimAutomationConversationInput,
  ) => Promise<ClaimedAutomationConversation>;
  ensureAutomationSandbox: (
    input: EnsureAutomationSandboxInput,
  ) => Promise<EnsuredAutomationSandbox>;
  acquireAutomationConnection: (
    input: AcquireAutomationConnectionInput,
  ) => Promise<AcquiredAutomationConnection>;
  deliverAutomationPayload: (input: DeliverAutomationPayloadInput) => Promise<void>;
  markAutomationRunCompleted: (input: HandleAutomationRunWorkflowInput) => Promise<void>;
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

      await step.run({ name: "claim-automation-conversation" }, async () =>
        ctx.claimAutomationConversation({
          preparedAutomationRun,
        }),
      );

      const ensuredAutomationSandbox = await step.run(
        { name: "ensure-automation-sandbox" },
        async () =>
          ctx.ensureAutomationSandbox({
            preparedAutomationRun,
          }),
      );

      const acquiredAutomationConnection = await step.run(
        { name: "acquire-automation-connection" },
        async () =>
          ctx.acquireAutomationConnection({
            preparedAutomationRun,
            ensuredAutomationSandbox,
          }),
      );

      await step.run({ name: "deliver-automation-payload" }, async () =>
        ctx.deliverAutomationPayload({
          preparedAutomationRun,
          ensuredAutomationSandbox,
          acquiredAutomationConnection,
        }),
      );

      await step.run({ name: "mark-automation-run-completed" }, async () =>
        ctx.markAutomationRunCompleted(workflowInput),
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
