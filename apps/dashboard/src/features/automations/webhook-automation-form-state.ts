import { buildAgentInstructionTokenCatalog } from "./agent-instructions-token-catalog.js";
import { resolveConversationKeyFieldOptions } from "./webhook-automation-conversation-key-field.js";
import { isWebhookAutomationEventOptionUnavailable } from "./webhook-automation-event-option-availability.js";
import type {
  WebhookAutomationFormOption,
  WebhookAutomationFormValues,
} from "./webhook-automation-form-types.js";
import { WebhookAutomationWorkspaceRootRepositoryOptionValue } from "./webhook-automation-option-builders.js";
import { resolveSelectedWebhookAutomationEventOptions } from "./webhook-automation-trigger-picker-state.js";
import type {
  WebhookAutomationEventOption,
  WebhookAutomationTriggerParameterValueMap,
} from "./webhook-automation-trigger-types.js";

export function resolveWebhookAutomationFormPresentation(input: {
  mode: "create" | "edit";
  values: Pick<WebhookAutomationFormValues, "primaryRepositoryId" | "sandboxProfileId">;
  primaryRepositoryOptions: readonly WebhookAutomationFormOption[] | undefined;
}): {
  submitLabel: string;
  shouldShowAutomationEnabledField: boolean;
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
    selectedPrimaryRepositoryOption?.value === WebhookAutomationWorkspaceRootRepositoryOptionValue;

  return {
    submitLabel: input.mode === "create" ? "Create" : "Save",
    shouldShowAutomationEnabledField: input.mode === "edit",
    shouldShowCreateNameField: input.mode === "create",
    shouldShowPrimaryRepositoryField:
      input.values.sandboxProfileId.trim().length > 0 &&
      (input.primaryRepositoryOptions?.length ?? 0) > 0,
    selectedPrimaryRepositoryPath,
    selectedWorkspaceRoot,
  };
}

export function resolveWebhookAutomationFormState(input: {
  webhookEventOptions: readonly WebhookAutomationEventOption[];
  selectedTriggerIds: readonly string[];
  conversationKeyTemplate: string;
  triggerParameterValues?: WebhookAutomationTriggerParameterValueMap;
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
    ...(input.triggerParameterValues === undefined
      ? {}
      : { triggerParameterValues: input.triggerParameterValues }),
  });
  const selectedConversationGroupingLabel = conversationKeySelectionState.options.find(
    (option) => option.template === conversationKeySelectionState.selectedTemplate,
  )?.label;
  const triggerHeaderMessage =
    input.selectedTriggerIds.length > 0 &&
    input.triggerIdsError !== undefined &&
    input.triggerIdsError !== "Event is unavailable for the selected sandbox profile."
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
