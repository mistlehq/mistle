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
  providerFamily: string;
  providerModel: string;
};

export type ClaimAutomationConversationInput = {
  preparedAutomationRun: PreparedAutomationRun;
};

export type ClaimedAutomationConversation = {
  conversationId: string;
  providerFamily: string;
};

export type EnsureAutomationConversationSandboxInput = {
  preparedAutomationRun: PreparedAutomationRun;
  claimedAutomationConversation: ClaimedAutomationConversation;
};

export type EnsuredAutomationConversationSandbox = {
  sandboxInstanceId: string;
  startupWorkflowRunId: string | null;
  routeId: string | null;
  providerConversationId: string | null;
  providerExecutionId: string | null;
};

export type EnsureAutomationConversationRouteInput = {
  preparedAutomationRun: PreparedAutomationRun;
  claimedAutomationConversation: ClaimedAutomationConversation;
  ensuredAutomationConversationSandbox: EnsuredAutomationConversationSandbox;
};

export type RoutedAutomationConversation = {
  routeId: string;
  sandboxInstanceId: string;
  providerConversationId: string | null;
  providerExecutionId: string | null;
};

export type EnsureAutomationConversationBindingInput = {
  preparedAutomationRun: PreparedAutomationRun;
  claimedAutomationConversation: ClaimedAutomationConversation;
  routedAutomationConversation: RoutedAutomationConversation;
};

export type BoundAutomationConversation = {
  routeId: string;
  sandboxInstanceId: string;
  providerConversationId: string;
  providerExecutionId: string | null;
  providerStatus: "idle" | "active";
  resumeRequired: boolean;
};

export type ExecuteAutomationConversationInput = {
  preparedAutomationRun: PreparedAutomationRun;
  boundAutomationConversation: BoundAutomationConversation;
};

export type ExecutedAutomationConversation = {
  providerExecutionId: string | null;
  providerState?: unknown;
};

export type PersistAutomationConversationExecutionInput = {
  preparedAutomationRun: PreparedAutomationRun;
  boundAutomationConversation: BoundAutomationConversation;
  executedAutomationConversation: ExecutedAutomationConversation;
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
  ensureAutomationConversationSandbox: (
    input: EnsureAutomationConversationSandboxInput,
  ) => Promise<EnsuredAutomationConversationSandbox>;
  ensureAutomationConversationRoute: (
    input: EnsureAutomationConversationRouteInput,
  ) => Promise<RoutedAutomationConversation>;
  ensureAutomationConversationBinding: (
    input: EnsureAutomationConversationBindingInput,
  ) => Promise<BoundAutomationConversation>;
  executeAutomationConversation: (
    input: ExecuteAutomationConversationInput,
  ) => Promise<ExecutedAutomationConversation>;
  persistAutomationConversationExecution: (
    input: PersistAutomationConversationExecutionInput,
  ) => Promise<void>;
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

      const claimedAutomationConversation = await step.run(
        { name: "claim-automation-conversation" },
        async () =>
          ctx.claimAutomationConversation({
            preparedAutomationRun,
          }),
      );

      const ensuredAutomationConversationSandbox = await step.run(
        { name: "ensure-automation-conversation-sandbox" },
        async () =>
          ctx.ensureAutomationConversationSandbox({
            preparedAutomationRun,
            claimedAutomationConversation,
          }),
      );

      const routedAutomationConversation = await step.run(
        { name: "ensure-automation-conversation-route" },
        async () =>
          ctx.ensureAutomationConversationRoute({
            preparedAutomationRun,
            claimedAutomationConversation,
            ensuredAutomationConversationSandbox,
          }),
      );

      const boundAutomationConversation = await step.run(
        { name: "ensure-automation-conversation-binding" },
        async () =>
          ctx.ensureAutomationConversationBinding({
            preparedAutomationRun,
            claimedAutomationConversation,
            routedAutomationConversation,
          }),
      );

      const executedAutomationConversation = await step.run(
        { name: "execute-automation-conversation" },
        async () =>
          ctx.executeAutomationConversation({
            preparedAutomationRun,
            boundAutomationConversation,
          }),
      );

      await step.run({ name: "persist-automation-conversation-execution" }, async () =>
        ctx.persistAutomationConversationExecution({
          preparedAutomationRun,
          boundAutomationConversation,
          executedAutomationConversation,
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
