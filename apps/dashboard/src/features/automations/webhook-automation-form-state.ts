import { buildAgentInstructionTokenCatalog } from "./agent-instructions-token-catalog.js";
import { resolveConversationKeyFieldOptions } from "./webhook-automation-conversation-key-field.js";
import { isWebhookAutomationEventOptionUnavailable } from "./webhook-automation-event-option-availability.js";
import { resolveSelectedWebhookAutomationEventOptions } from "./webhook-automation-trigger-picker-state.js";
import type { WebhookAutomationEventOption } from "./webhook-automation-trigger-types.js";

export function resolveWebhookAutomationFormState(input: {
  webhookEventOptions: readonly WebhookAutomationEventOption[];
  selectedTriggerIds: readonly string[];
  conversationKeyTemplate: string;
  triggerIdsError: string | undefined;
}): {
  selectedTriggerOptions: readonly WebhookAutomationEventOption[];
  selectedConnectionId: string;
  triggerHeaderMessage: string | undefined;
  hasSelectedTrigger: boolean;
  conversationKeySelectionState: ReturnType<typeof resolveConversationKeyFieldOptions>;
  selectedConversationGroupingLabel: string | undefined;
  agentInstructionTokens: ReturnType<typeof buildAgentInstructionTokenCatalog>;
} {
  const selectedTriggerOptions = resolveSelectedWebhookAutomationEventOptions({
    eventOptions: input.webhookEventOptions,
    selectedTriggerIds: input.selectedTriggerIds,
  });
  const selectedConnectionIds = new Set(
    selectedTriggerOptions
      .filter((option) => !isWebhookAutomationEventOptionUnavailable(option))
      .map((option) => option.connectionId)
      .filter((connectionId) => connectionId.trim().length > 0),
  );
  const selectedConnectionId =
    selectedConnectionIds.size === 1 ? ([...selectedConnectionIds][0] ?? "") : "";
  const conversationKeySelectionState = resolveConversationKeyFieldOptions({
    selectedEventOptions: selectedTriggerOptions,
    currentTemplate: input.conversationKeyTemplate,
  });
  const selectedConversationGroupingLabel = conversationKeySelectionState.options.find(
    (option) => option.template === conversationKeySelectionState.selectedTemplate,
  )?.label;
  const triggerHeaderMessage =
    input.selectedTriggerIds.length > 0 &&
    input.triggerIdsError !== undefined &&
    input.triggerIdsError !== "Trigger is unavailable for the selected sandbox profile."
      ? input.triggerIdsError
      : undefined;

  return {
    selectedTriggerOptions,
    selectedConnectionId,
    triggerHeaderMessage,
    hasSelectedTrigger: input.selectedTriggerIds.length > 0,
    conversationKeySelectionState,
    selectedConversationGroupingLabel,
    agentInstructionTokens: buildAgentInstructionTokenCatalog({
      selectedEventOptions: selectedTriggerOptions,
    }),
  };
}
