import { isWebhookAutomationEventOptionUnavailable } from "./webhook-automation-event-option-availability.js";
import type {
  WebhookAutomationConversationKeyOption,
  WebhookAutomationEventOption,
} from "./webhook-automation-trigger-types.js";

export function resolveCommonWebhookAutomationConversationKeyOptions(input: {
  selectedEventOptions: readonly WebhookAutomationEventOption[];
}): readonly WebhookAutomationConversationKeyOption[] {
  const availableEventOptions = input.selectedEventOptions.filter(
    (eventOption) => !isWebhookAutomationEventOptionUnavailable(eventOption),
  );

  if (availableEventOptions.length === 0) {
    return [];
  }

  const [firstEventOption, ...remainingEventOptions] = availableEventOptions;
  const firstConversationKeyOptions = firstEventOption?.conversationKeyOptions ?? [];

  return firstConversationKeyOptions.filter((conversationKeyOption) =>
    remainingEventOptions.every((eventOption) =>
      (eventOption.conversationKeyOptions ?? []).some(
        (candidateOption) =>
          candidateOption.id === conversationKeyOption.id &&
          candidateOption.label === conversationKeyOption.label &&
          candidateOption.description === conversationKeyOption.description &&
          candidateOption.template === conversationKeyOption.template,
      ),
    ),
  );
}
