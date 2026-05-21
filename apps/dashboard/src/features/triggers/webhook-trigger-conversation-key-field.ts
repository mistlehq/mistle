import { resolveCommonWebhookTriggerConversationKeyOptions } from "./webhook-trigger-conversation-key-options.js";
import type {
  WebhookTriggerConversationKeyOption,
  WebhookTriggerEventOption,
  WebhookTriggerEventParameterRuleMap,
} from "./webhook-trigger-event-types.js";

export function resolveConversationKeyFieldOptions(input: {
  selectedEventOptions: readonly WebhookTriggerEventOption[];
  currentTemplate: string;
  eventParameterRules?: WebhookTriggerEventParameterRuleMap;
}): {
  options: readonly WebhookTriggerConversationKeyOption[];
  selectedTemplate: string;
  hasUnsupportedCurrentTemplate: boolean;
} {
  const options = resolveCommonWebhookTriggerConversationKeyOptions({
    selectedEventOptions: input.selectedEventOptions,
    ...(input.eventParameterRules === undefined
      ? {}
      : { eventParameterRules: input.eventParameterRules }),
  });
  const isCurrentTemplateSupported =
    input.currentTemplate.trim().length > 0 &&
    options.some((option) => option.template === input.currentTemplate);

  return {
    options,
    selectedTemplate: isCurrentTemplateSupported ? input.currentTemplate : "",
    hasUnsupportedCurrentTemplate:
      input.currentTemplate.trim().length > 0 && !isCurrentTemplateSupported,
  };
}
