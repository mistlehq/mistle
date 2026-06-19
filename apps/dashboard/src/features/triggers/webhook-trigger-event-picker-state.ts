import {
  createSyntheticWebhookTriggerEventOption,
  isWebhookTriggerEventOptionUnavailable,
} from "./webhook-trigger-event-option-availability.js";
import type { WebhookTriggerEventOption } from "./webhook-trigger-event-types.js";
import { resolveWebhookTriggerEventOptionIdFromConditionId } from "./webhook-trigger-option-builders.js";

type GroupedWebhookTriggerEventOptions = {
  connectionLabel: string;
  logoKey?: string;
  items: readonly WebhookTriggerEventOption[];
};

type WebhookTriggerEventPickerState = {
  availableEventOptions: readonly WebhookTriggerEventOption[];
  groupedAvailableEventOptions: readonly GroupedWebhookTriggerEventOptions[];
  disabled: boolean;
  helperMessage: string | null;
  helperVariant: "default" | "alert";
  inputPlaceholder: string;
  shouldShowNoAvailableTriggerEventsNotice: boolean;
};

export type WebhookTriggerEventPickerDisabledState = {
  reason: string;
  variant: "default" | "alert";
};

export function groupWebhookTriggerEventOptions(
  eventOptions: readonly WebhookTriggerEventOption[],
): readonly GroupedWebhookTriggerEventOptions[] {
  const groups = new Map<string, WebhookTriggerEventOption[]>();

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

export function resolveSelectedWebhookTriggerEventOptions(input: {
  eventOptions: readonly WebhookTriggerEventOption[];
  selectedEventIds: readonly string[];
}): readonly WebhookTriggerEventOption[] {
  return input.selectedEventIds.map((triggerId) => {
    const eventOptionId = resolveWebhookTriggerEventOptionIdFromConditionId(triggerId);
    const matchedOption = input.eventOptions.find(
      (candidate) => candidate.id === triggerId || candidate.id === eventOptionId,
    );
    if (matchedOption !== undefined) {
      return {
        ...matchedOption,
        id: triggerId,
      };
    }

    return {
      ...createSyntheticWebhookTriggerEventOption({
        triggerId: eventOptionId,
        availability: "missing_integration",
      }),
      id: triggerId,
    } satisfies WebhookTriggerEventOption;
  });
}

export function resolveWebhookTriggerEventPickerState(input: {
  hasConnectedIntegrations: boolean;
  selectedEventIds: readonly string[];
  eventOptions: readonly WebhookTriggerEventOption[];
  disabledState?: WebhookTriggerEventPickerDisabledState | null;
}): WebhookTriggerEventPickerState {
  if (input.disabledState !== undefined && input.disabledState !== null) {
    return {
      availableEventOptions: [],
      groupedAvailableEventOptions: [],
      disabled: true,
      helperMessage: input.disabledState.reason,
      helperVariant: input.disabledState.variant,
      inputPlaceholder: "No events available",
      shouldShowNoAvailableTriggerEventsNotice: false,
    };
  }

  const availableEventOptions = input.eventOptions.filter(
    (option) => !isWebhookTriggerEventOptionUnavailable(option),
  );
  const hasAvailableTriggers = availableEventOptions.length > 0;

  return {
    availableEventOptions,
    groupedAvailableEventOptions: groupWebhookTriggerEventOptions(availableEventOptions),
    disabled: !input.hasConnectedIntegrations || !hasAvailableTriggers,
    helperMessage: input.hasConnectedIntegrations ? null : "Connect an integration to add events.",
    helperVariant: "default",
    inputPlaceholder: hasAvailableTriggers ? "Add condition" : "No events available",
    shouldShowNoAvailableTriggerEventsNotice:
      input.hasConnectedIntegrations &&
      input.selectedEventIds.length === 0 &&
      !hasAvailableTriggers,
  };
}
