export type PreparedTriggerRun = {
  triggerRunId: string;
  triggerRunCreatedAt: string;
  triggerId: string;
  conversationId: string;
  triggerTargetId: string;
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

export type EnsuredTriggerSandbox = {
  sandboxInstanceId: string;
  startupWorkflowRunId: string | null;
};

export type MarkTriggerRunFailedInput = {
  triggerRunId: string;
  failureCode: string;
  failureMessage: string;
};

export type HandoffTriggerRunDeliveryInput = {
  preparedTriggerRun: PreparedTriggerRun;
};

export type PrepareTriggerRunInput = {
  triggerRunId: string;
};
