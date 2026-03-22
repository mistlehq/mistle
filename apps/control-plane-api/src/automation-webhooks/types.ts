export type AutomationWebhookAggregate = {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  integrationConnectionId: string;
  eventTypes: ReadonlyArray<string> | null;
  payloadFilter: Record<string, unknown> | null;
  inputTemplate: string;
  conversationKeyTemplate: string;
  idempotencyKeyTemplate: string | null;
  target: {
    id: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number | null;
  };
};

export type ListWebhookAutomationsInput = {
  organizationId: string;
};

export type GetWebhookAutomationInput = {
  organizationId: string;
  automationId: string;
};

export type CreateWebhookAutomationInput = {
  organizationId: string;
  name: string;
  enabled?: boolean;
  integrationConnectionId: string;
  eventTypes?: ReadonlyArray<string> | null;
  payloadFilter?: Record<string, unknown> | null;
  inputTemplate: string;
  conversationKeyTemplate: string;
  idempotencyKeyTemplate?: string | null;
  target: {
    sandboxProfileId: string;
    sandboxProfileVersion?: number | null;
  };
};

export type UpdateWebhookAutomationInput = {
  organizationId: string;
  automationId: string;
  name?: string;
  enabled?: boolean;
  integrationConnectionId?: string;
  eventTypes?: ReadonlyArray<string> | null;
  payloadFilter?: Record<string, unknown> | null;
  inputTemplate?: string;
  conversationKeyTemplate?: string;
  idempotencyKeyTemplate?: string | null;
  target?: {
    sandboxProfileId?: string;
    sandboxProfileVersion?: number | null;
  };
};

export type DeleteWebhookAutomationInput = {
  organizationId: string;
  automationId: string;
};
