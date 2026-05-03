import {
  createSyntheticWebhookAutomationEventOption,
  isWebhookAutomationEventOptionUnavailable,
} from "./webhook-automation-event-option-availability.js";
import type { WebhookAutomationEventOption } from "./webhook-automation-trigger-types.js";

type GroupedWebhookAutomationEventOptions = {
  connectionLabel: string;
  logoKey?: string;
  items: readonly WebhookAutomationEventOption[];
};

type WebhookAutomationTriggerPickerState = {
  availableEventOptions: readonly WebhookAutomationEventOption[];
  groupedAvailableEventOptions: readonly GroupedWebhookAutomationEventOptions[];
  disabled: boolean;
  helperMessage: string | null;
  helperVariant: "default" | "alert";
  inputPlaceholder: string;
};

export type WebhookAutomationTriggerPickerDisabledState = {
  reason: string;
  variant: "default" | "alert";
};

export function groupWebhookAutomationEventOptions(
  eventOptions: readonly WebhookAutomationEventOption[],
): readonly GroupedWebhookAutomationEventOptions[] {
  const groups = new Map<string, WebhookAutomationEventOption[]>();

  for (const option of eventOptions) {
    const connectionLabel =
      option.connectionLabel.trim().length > 0 ? option.connectionLabel : "Other integrations";
    const existingItems = groups.get(connectionLabel);
    if (existingItems === undefined) {
      groups.set(connectionLabel, [option]);
      continue;
    }

    existingItems.push(option);
  }

  return Array.from(groups.entries())
    .sort(([leftConnectionLabel], [rightConnectionLabel]) =>
      leftConnectionLabel.localeCompare(rightConnectionLabel),
    )
    .map(([connectionLabel, items]) => {
      const sortedItems = [...items].sort((left, right) => left.label.localeCompare(right.label));

      return {
        connectionLabel,
        ...(sortedItems[0]?.logoKey === undefined ? {} : { logoKey: sortedItems[0].logoKey }),
        items: sortedItems,
      };
    });
}

export function resolveSelectedWebhookAutomationEventOptions(input: {
  eventOptions: readonly WebhookAutomationEventOption[];
  selectedTriggerIds: readonly string[];
}): readonly WebhookAutomationEventOption[] {
  return input.selectedTriggerIds.map((triggerId) => {
    const matchedOption = input.eventOptions.find((candidate) => candidate.id === triggerId);
    if (matchedOption !== undefined) {
      return matchedOption;
    }

    return {
      ...createSyntheticWebhookAutomationEventOption({
        triggerId,
        availability: "missing_integration",
      }),
    } satisfies WebhookAutomationEventOption;
  });
}

export function resolveWebhookAutomationTriggerPickerState(input: {
  hasConnectedIntegrations: boolean;
  selectedTriggerIds: readonly string[];
  eventOptions: readonly WebhookAutomationEventOption[];
  disabledState?: WebhookAutomationTriggerPickerDisabledState | null;
}): WebhookAutomationTriggerPickerState {
  if (input.disabledState !== undefined && input.disabledState !== null) {
    return {
      availableEventOptions: [],
      groupedAvailableEventOptions: [],
      disabled: true,
      helperMessage: input.disabledState.reason,
      helperVariant: input.disabledState.variant,
      inputPlaceholder: "No events available",
    };
  }

  const selectedTriggerIdSet = new Set(input.selectedTriggerIds);
  const availableEventOptions = input.eventOptions.filter(
    (option) =>
      !isWebhookAutomationEventOptionUnavailable(option) && !selectedTriggerIdSet.has(option.id),
  );
  const hasAvailableTriggers = availableEventOptions.length > 0;

  return {
    availableEventOptions,
    groupedAvailableEventOptions: groupWebhookAutomationEventOptions(availableEventOptions),
    disabled: !input.hasConnectedIntegrations || !hasAvailableTriggers,
    helperMessage: input.hasConnectedIntegrations ? null : "Connect an integration to add events.",
    helperVariant: "default",
    inputPlaceholder: hasAvailableTriggers ? "Add event" : "No events available",
  };
}
