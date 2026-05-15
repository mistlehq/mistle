import { resolveCommonWebhookAutomationConversationKeyOptions } from "./webhook-automation-conversation-key-options.js";
import type {
  WebhookAutomationConversationKeyOption,
  WebhookAutomationEventOption,
  WebhookAutomationTriggerParameterValueMap,
} from "./webhook-automation-trigger-types.js";

export function resolveConversationKeyFieldOptions(input: {
  selectedEventOptions: readonly WebhookAutomationEventOption[];
  currentTemplate: string;
  triggerParameterValues?: WebhookAutomationTriggerParameterValueMap;
}): {
  options: readonly WebhookAutomationConversationKeyOption[];
  selectedTemplate: string;
  hasUnsupportedCurrentTemplate: boolean;
} {
  const options = resolveCommonWebhookAutomationConversationKeyOptions({
    selectedEventOptions: input.selectedEventOptions,
    ...(input.triggerParameterValues === undefined
      ? {}
      : { triggerParameterValues: input.triggerParameterValues }),
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
