export const WebhookAutomationEventOptionAvailabilities = {
  AVAILABLE: "available",
  MISSING_INTEGRATION: "missing_integration",
  WRONG_PROFILE: "wrong_profile",
} as const;

export type WebhookAutomationEventOptionAvailability =
  (typeof WebhookAutomationEventOptionAvailabilities)[keyof typeof WebhookAutomationEventOptionAvailabilities];

export type WebhookAutomationEventParameterOption =
  | {
      id: string;
      label: string;
      kind: "resource-select";
      resourceKind: string;
      payloadPath: string[];
      prefix?: string;
      placeholder?: string;
    }
  | {
      id: string;
      label: string;
      kind: "string";
      payloadPath: string[];
      prefix?: string;
      placeholder?: string;
    }
  | {
      id: string;
      label: string;
      kind: "enum-select";
      payloadPath: string[];
      matchMode: "eq" | "exists";
      options: readonly {
        value: string;
        label: string;
      }[];
      prefix?: string;
      placeholder?: string;
    };

export type WebhookAutomationConversationKeyOption = {
  id: string;
  label: string;
  description: string;
  template: string;
};

export type WebhookAutomationEventOption = {
  id: string;
  eventType: string;
  connectionId: string;
  connectionLabel: string;
  label: string;
  description?: string;
  category?: string;
  logoKey?: string;
  availability?: WebhookAutomationEventOptionAvailability;
  conversationKeyOptions?: readonly WebhookAutomationConversationKeyOption[];
  parameters?: readonly WebhookAutomationEventParameterOption[];
};

export type WebhookAutomationTriggerParameterValueMap = Record<string, Record<string, string>>;
