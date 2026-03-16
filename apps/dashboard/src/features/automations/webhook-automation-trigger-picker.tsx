import {
  Button,
  Combobox,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  useComboboxAnchor,
} from "@mistle/ui";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useId } from "react";

import { resolveIntegrationLogoPath } from "../integrations/logo.js";

export type WebhookAutomationEventOption = {
  value: string;
  label: string;
  description?: string;
  category?: string;
  logoKey?: string;
  unavailable?: boolean;
};

type GroupedWebhookAutomationEventOptions = {
  category: string;
  items: readonly WebhookAutomationEventOption[];
};

type WebhookAutomationTriggerPickerState = {
  availableEventOptions: readonly WebhookAutomationEventOption[];
  groupedAvailableEventOptions: readonly GroupedWebhookAutomationEventOptions[];
  disabled: boolean;
  helperMessage: string | null;
  inputPlaceholder: string;
};

export function groupWebhookAutomationEventOptions(
  eventOptions: readonly WebhookAutomationEventOption[],
): readonly GroupedWebhookAutomationEventOptions[] {
  const groups = new Map<string, WebhookAutomationEventOption[]>();

  for (const option of eventOptions) {
    const category = option.category ?? "Other events";
    const existingItems = groups.get(category);
    if (existingItems === undefined) {
      groups.set(category, [option]);
      continue;
    }

    existingItems.push(option);
  }

  return Array.from(groups.entries())
    .sort(([leftCategory], [rightCategory]) => leftCategory.localeCompare(rightCategory))
    .map(([category, items]) => ({
      category,
      items: [...items].sort((left, right) => left.label.localeCompare(right.label)),
    }));
}

export function resolveSelectedWebhookAutomationEventOptions(input: {
  eventOptions: readonly WebhookAutomationEventOption[];
  selectedEventTypes: readonly string[];
}): readonly WebhookAutomationEventOption[] {
  return input.selectedEventTypes.map((eventType) => {
    const matchedOption = input.eventOptions.find((candidate) => candidate.value === eventType);
    if (matchedOption !== undefined) {
      return matchedOption;
    }

    return {
      value: eventType,
      label: eventType,
      description: "No longer available from your connected integrations.",
      category: "Unavailable",
      unavailable: true,
    } satisfies WebhookAutomationEventOption;
  });
}

function resolveWebhookAutomationTriggerPickerState(input: {
  hasConnectedIntegrations: boolean;
  eventOptions: readonly WebhookAutomationEventOption[];
}): WebhookAutomationTriggerPickerState {
  const availableEventOptions = input.eventOptions.filter((option) => option.unavailable !== true);
  const hasAvailableTriggers = availableEventOptions.length > 0;

  return {
    availableEventOptions,
    groupedAvailableEventOptions: groupWebhookAutomationEventOptions(availableEventOptions),
    disabled: !input.hasConnectedIntegrations || !hasAvailableTriggers,
    helperMessage: input.hasConnectedIntegrations
      ? null
      : "Connect an integration to add triggers.",
    inputPlaceholder: hasAvailableTriggers ? "Add trigger" : "No triggers available",
  };
}

export function WebhookAutomationTriggerPicker(input: {
  hasConnectedIntegrations: boolean;
  selectedEventTypes: readonly string[];
  eventOptions: readonly WebhookAutomationEventOption[];
  error: string | undefined;
  onValueChange: (value: string[]) => void;
}): React.JSX.Element {
  const selectedEventOptions = resolveSelectedWebhookAutomationEventOptions({
    eventOptions: input.eventOptions,
    selectedEventTypes: input.selectedEventTypes,
  });
  const pickerState = resolveWebhookAutomationTriggerPickerState({
    hasConnectedIntegrations: input.hasConnectedIntegrations,
    eventOptions: input.eventOptions,
  });
  const anchorRef = useComboboxAnchor();
  const triggerPickerId = useId();

  return (
    <div className="space-y-3">
      <Combobox<string, true>
        autoHighlight
        disabled={pickerState.disabled}
        multiple
        onValueChange={(value) => {
          input.onValueChange(value);
        }}
        value={[...input.selectedEventTypes]}
      >
        <div ref={anchorRef}>
          <div className="relative">
            <PlusIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 z-10 size-4 -translate-y-1/2" />
            <ComboboxInput
              aria-invalid={input.error === undefined ? undefined : true}
              className="w-full [&_[data-slot=input-group-control]]:pl-10"
              disabled={pickerState.disabled}
              id={triggerPickerId}
              placeholder={pickerState.inputPlaceholder}
              showClear={false}
            />
          </div>
        </div>

        <ComboboxContent
          align="start"
          anchor={anchorRef}
          className="w-[min(34rem,calc(100vw-2rem))] p-0"
        >
          <ComboboxList className="max-h-80">
            {pickerState.groupedAvailableEventOptions.map((group) => (
              <ComboboxGroup key={group.category}>
                <ComboboxLabel>{group.category}</ComboboxLabel>
                {group.items.map((option) => (
                  <ComboboxItem key={option.value} value={option.value}>
                    <span className="truncate">{option.label}</span>
                  </ComboboxItem>
                ))}
              </ComboboxGroup>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>

      {pickerState.helperMessage === null ? null : (
        <p className="text-muted-foreground text-sm">{pickerState.helperMessage}</p>
      )}

      {selectedEventOptions.length === 0 ? null : (
        <div className="space-y-1.5">
          {selectedEventOptions.map((option) => (
            <div
              className="bg-muted/20 flex items-center justify-between gap-2.5 rounded-lg border px-3.5 py-2"
              key={option.value}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  {option.logoKey === undefined ? null : (
                    <img
                      alt=""
                      aria-hidden
                      className="size-4 shrink-0"
                      src={resolveIntegrationLogoPath({ logoKey: option.logoKey })}
                    />
                  )}
                  <p className="text-sm leading-none font-medium">{option.label}</p>
                  {option.unavailable === true ? (
                    <span className="text-destructive text-xs">Unavailable</span>
                  ) : null}
                </div>
              </div>
              <Button
                aria-label={`Remove ${option.label} trigger`}
                onClick={() => {
                  input.onValueChange(
                    input.selectedEventTypes.filter(
                      (selectedEventType) => selectedEventType !== option.value,
                    ),
                  );
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
                className="size-7"
              >
                <TrashIcon aria-hidden className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
