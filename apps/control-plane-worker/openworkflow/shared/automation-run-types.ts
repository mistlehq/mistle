import type { HandleAutomationRunWorkflowInput } from "@mistle/workflow-registry/control-plane";

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

export type EnsuredAutomationSandbox = {
  sandboxInstanceId: string;
  startupWorkflowRunId: string | null;
};

export type MarkAutomationRunFailedInput = {
  automationRunId: string;
  failureCode: string;
  failureMessage: string;
};

export type HandoffAutomationRunDeliveryInput = {
  preparedAutomationRun: PreparedAutomationRun;
};

export type PrepareAutomationRunInput = HandleAutomationRunWorkflowInput;
