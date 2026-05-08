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
  primaryRepositoryId: string | null;
  workingDirectory: string;
  sourceKind: "webhook" | "schedule";
  sourceOrderKey: string;
  sourceWebhookEventId: string | undefined;
  sourceScheduledActionId: string | undefined;
  integrationConnectionId: string | undefined;
  targetKey: string | undefined;
  webhookEventId: string | undefined;
  webhookEventType: string | undefined;
  webhookProviderEventType: string | undefined;
  webhookExternalEventId: string | undefined;
  webhookExternalDeliveryId: string | null | undefined;
  webhookPayload: Record<string, unknown> | undefined;
  scheduledActionId: string | undefined;
  scheduledAt: string | undefined;
  localScheduledDate: string | undefined;
  localScheduledTime: string | undefined;
  actingUserId?: string;
  renderedInput: string;
  renderedConversationKey: string;
  renderedIdempotencyKey: string | null;
  instructions: string | null;
  collaborationModeSettings: {
    developerInstructions: string | null;
  } | null;
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
