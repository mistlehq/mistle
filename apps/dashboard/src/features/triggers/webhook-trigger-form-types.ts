import type { WebhookTriggerEventParameterValueMap } from "./webhook-trigger-event-types.js";

export type WebhookTriggerFormOption = {
  value: string;
  label: string;
  description?: string;
  path?: string;
};

export type WebhookTriggerFormValues = {
  name: string;
  sandboxProfileId: string;
  primaryRepositoryId: string;
  enabled: boolean;
  inputTemplate: string;
  instructions: string;
  conversationKeyTemplate: string;
  eventIds: string[];
  eventParameterValues: WebhookTriggerEventParameterValueMap;
};

export type WebhookTriggerFormValueKey = keyof WebhookTriggerFormValues;
