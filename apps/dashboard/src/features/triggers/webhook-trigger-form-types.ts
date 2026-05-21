import type { WebhookTriggerEventParameterRuleMap } from "./webhook-trigger-event-types.js";

export type WebhookTriggerFormOption = {
  value: string;
  label: string;
  description?: string;
  path?: string;
  sandboxProfileDisplayName?: string;
  sandboxProfileVersion?: number | null;
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
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
};

export type WebhookTriggerFormValueKey = keyof WebhookTriggerFormValues;
