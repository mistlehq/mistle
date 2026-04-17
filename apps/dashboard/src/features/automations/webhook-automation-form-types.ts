import type { WebhookAutomationTriggerParameterValueMap } from "./webhook-automation-trigger-types.js";

export type WebhookAutomationFormOption = {
  value: string;
  label: string;
  description?: string;
};

export type WebhookAutomationFormValues = {
  name: string;
  sandboxProfileId: string;
  enabled: boolean;
  inputTemplate: string;
  instructions: string;
  conversationKeyTemplate: string;
  triggerIds: string[];
  triggerParameterValues: WebhookAutomationTriggerParameterValueMap;
};

export type WebhookAutomationFormValueKey = keyof WebhookAutomationFormValues;
