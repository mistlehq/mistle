import type {
  WebhookAutomationConversationKeyOption,
  WebhookAutomationEventOption,
} from "./webhook-automation-trigger-types.js";

export function resolveCommonWebhookAutomationConversationKeyOptions(input: {
  selectedEventOptions: readonly WebhookAutomationEventOption[];
}): readonly WebhookAutomationConversationKeyOption[] {
  const availableEventOptions = input.selectedEventOptions.filter(
    (eventOption) => eventOption.unavailable !== true,
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
