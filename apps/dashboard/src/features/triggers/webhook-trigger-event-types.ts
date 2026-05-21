import type { IntegrationWebhookTriggerRequirements } from "@mistle/integrations-core";

export const WebhookTriggerEventOptionAvailabilities = {
  AVAILABLE: "available",
  MISSING_INTEGRATION: "missing_integration",
  WRONG_PROFILE: "wrong_profile",
} as const;

export type WebhookTriggerEventOptionAvailability =
  (typeof WebhookTriggerEventOptionAvailabilities)[keyof typeof WebhookTriggerEventOptionAvailabilities];

export type WebhookTriggerEventParameterOption =
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
      matchMode?: "eq" | "contains" | "contains_token";
      controlVariant?: "invocation-token";
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

export type WebhookTriggerConversationKeyOption = {
  id: string;
  label: string;
  description: string;
  template: string;
};

export type WebhookTriggerPayloadReference = {
  path: string[];
  description: string;
};

export type WebhookTriggerEventOption = {
  id: string;
  eventType: string;
  integrationWebhookSourceId: string;
  connectionId: string;
  connectionLabel: string;
  label: string;
  description?: string;
  category?: string;
  logoKey?: string;
  availability?: WebhookTriggerEventOptionAvailability;
  payloadReferences?: readonly WebhookTriggerPayloadReference[];
  conversationKeyOptions?: readonly WebhookTriggerConversationKeyOption[];
  parameters?: readonly WebhookTriggerEventParameterOption[];
  requirements?: IntegrationWebhookTriggerRequirements;
};

export const WebhookTriggerEventParameterRuleOperators = {
  IS: "is",
  IS_NOT: "is_not",
  CONTAINS: "contains",
  CONTAINS_TOKEN: "contains_token",
  EXISTS: "exists",
  NOT_EXISTS: "not_exists",
} as const;

export type WebhookTriggerEventParameterRuleOperator =
  (typeof WebhookTriggerEventParameterRuleOperators)[keyof typeof WebhookTriggerEventParameterRuleOperators];

export type WebhookTriggerEventParameterRule = {
  operator: WebhookTriggerEventParameterRuleOperator;
  value: string;
};

export type WebhookTriggerEventParameterRuleMap = Record<
  string,
  Record<string, WebhookTriggerEventParameterRule>
>;

export type WebhookTriggerEventParameterRulesByEventType = Record<
  string,
  Record<string, WebhookTriggerEventParameterRule>
>;
