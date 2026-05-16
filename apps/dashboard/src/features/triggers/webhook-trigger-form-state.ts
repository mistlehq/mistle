import { buildAgentInstructionTokenCatalog } from "./agent-instructions-token-catalog.js";
import { resolveConversationKeyFieldOptions } from "./webhook-trigger-conversation-key-field.js";
import { isWebhookTriggerEventOptionUnavailable } from "./webhook-trigger-event-option-availability.js";
import { resolveSelectedWebhookTriggerEventOptions } from "./webhook-trigger-event-picker-state.js";
import type {
  WebhookTriggerEventOption,
  WebhookTriggerEventParameterValueMap,
} from "./webhook-trigger-event-types.js";
import type {
  WebhookTriggerFormOption,
  WebhookTriggerFormValues,
} from "./webhook-trigger-form-types.js";
import { WebhookTriggerWorkspaceRootRepositoryOptionValue } from "./webhook-trigger-option-builders.js";

export function resolveWebhookTriggerFormPresentation(input: {
  mode: "create" | "edit";
  values: Pick<WebhookTriggerFormValues, "primaryRepositoryId" | "sandboxProfileId">;
  primaryRepositoryOptions: readonly WebhookTriggerFormOption[] | undefined;
}): {
  submitLabel: string;
  shouldShowTriggerEnabledField: boolean;
  shouldShowCreateNameField: boolean;
  shouldShowPrimaryRepositoryField: boolean;
  selectedPrimaryRepositoryPath: string | null;
  selectedWorkspaceRoot: boolean;
} {
  const selectedPrimaryRepositoryOption = input.primaryRepositoryOptions?.find(
    (option) => option.value === input.values.primaryRepositoryId,
  );
  const selectedPrimaryRepositoryPath = selectedPrimaryRepositoryOption?.path ?? null;
  const selectedWorkspaceRoot =
    selectedPrimaryRepositoryOption?.value === WebhookTriggerWorkspaceRootRepositoryOptionValue;

  return {
    submitLabel: input.mode === "create" ? "Create" : "Save",
    shouldShowTriggerEnabledField: input.mode === "edit",
    shouldShowCreateNameField: input.mode === "create",
    shouldShowPrimaryRepositoryField:
      input.values.sandboxProfileId.trim().length > 0 &&
      (input.primaryRepositoryOptions?.length ?? 0) > 0,
    selectedPrimaryRepositoryPath,
    selectedWorkspaceRoot,
  };
}

export function resolveWebhookTriggerFormState(input: {
  webhookEventOptions: readonly WebhookTriggerEventOption[];
  selectedEventIds: readonly string[];
  conversationKeyTemplate: string;
  eventParameterValues?: WebhookTriggerEventParameterValueMap;
  eventIdsError: string | undefined;
}): {
  selectedTriggerOptions: readonly WebhookTriggerEventOption[];
  selectedConnectionId: string;
  triggerHeaderMessage: string | undefined;
  hasSelectedTrigger: boolean;
  conversationKeySelectionState: ReturnType<typeof resolveConversationKeyFieldOptions>;
  selectedConversationGroupingLabel: string | undefined;
  agentInstructionTokens: ReturnType<typeof buildAgentInstructionTokenCatalog>;
} {
  const selectedTriggerOptions = resolveSelectedWebhookTriggerEventOptions({
    eventOptions: input.webhookEventOptions,
    selectedEventIds: input.selectedEventIds,
  });
  const selectedConnectionIds = new Set(
    selectedTriggerOptions
      .filter((option) => !isWebhookTriggerEventOptionUnavailable(option))
      .map((option) => option.connectionId)
      .filter((connectionId) => connectionId.trim().length > 0),
  );
  const selectedConnectionId =
    selectedConnectionIds.size === 1 ? ([...selectedConnectionIds][0] ?? "") : "";
  const conversationKeySelectionState = resolveConversationKeyFieldOptions({
    selectedEventOptions: selectedTriggerOptions,
    currentTemplate: input.conversationKeyTemplate,
    ...(input.eventParameterValues === undefined
      ? {}
      : { eventParameterValues: input.eventParameterValues }),
  });
  const selectedConversationGroupingLabel = conversationKeySelectionState.options.find(
    (option) => option.template === conversationKeySelectionState.selectedTemplate,
  )?.label;
  const triggerHeaderMessage =
    input.selectedEventIds.length > 0 &&
    input.eventIdsError !== undefined &&
    input.eventIdsError !== "Event is unavailable for the selected sandbox profile."
      ? input.eventIdsError
      : undefined;

  return {
    selectedTriggerOptions,
    selectedConnectionId,
    triggerHeaderMessage,
    hasSelectedTrigger: input.selectedEventIds.length > 0,
    conversationKeySelectionState,
    selectedConversationGroupingLabel,
    agentInstructionTokens: buildAgentInstructionTokenCatalog({
      selectedEventOptions: selectedTriggerOptions,
    }),
  };
}
