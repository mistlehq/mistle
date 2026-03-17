export type WebhookAutomationEventParameterOption = {
  id: string;
  label: string;
  kind: "resource-select";
  resourceKind: string;
  payloadPath: string[];
  prefix?: string;
};

export type WebhookAutomationEventOption = {
  value: string;
  label: string;
  description?: string;
  category?: string;
  logoKey?: string;
  unavailable?: boolean;
  parameters?: readonly WebhookAutomationEventParameterOption[];
};

export type WebhookAutomationTriggerParameterValueMap = Record<string, Record<string, string>>;
