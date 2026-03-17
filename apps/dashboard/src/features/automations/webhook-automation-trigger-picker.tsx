import {
  Button,
  Combobox,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useComboboxAnchor,
} from "@mistle/ui";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";

import { listIntegrationConnectionResources } from "../integrations/integrations-service.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import type {
  WebhookAutomationEventOption,
  WebhookAutomationTriggerParameterValueMap,
} from "./webhook-automation-trigger-types.js";

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
  selectedConnectionId: string;
  selectedEventTypes: readonly string[];
  eventOptions: readonly WebhookAutomationEventOption[];
  triggerParameterValues: WebhookAutomationTriggerParameterValueMap;
  error: string | undefined;
  onValueChange: (value: string[]) => void;
  onTriggerParameterValueChange: (input: {
    eventType: string;
    parameterId: string;
    value: string;
  }) => void;
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
                  {option.parameters?.map((parameter) => (
                    <TriggerParameterField
                      connectionId={input.selectedConnectionId}
                      eventType={option.value}
                      key={`${option.value}:${parameter.id}`}
                      onValueChange={(value) => {
                        input.onTriggerParameterValueChange({
                          eventType: option.value,
                          parameterId: parameter.id,
                          value,
                        });
                      }}
                      parameter={parameter}
                      value={input.triggerParameterValues[option.value]?.[parameter.id] ?? ""}
                    />
                  ))}
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

function TriggerParameterField(input: {
  connectionId: string;
  eventType: string;
  parameter: NonNullable<WebhookAutomationEventOption["parameters"]>[number];
  value: string;
  onValueChange: (value: string) => void;
}): React.JSX.Element | null {
  const resourceQuery = useQuery({
    queryKey: ["automation-trigger-parameters", input.connectionId, input.parameter.resourceKind],
    queryFn: async ({ signal }) =>
      listIntegrationConnectionResources({
        connectionId: input.connectionId,
        kind: input.parameter.resourceKind,
        signal,
      }),
    enabled: input.connectionId.trim().length > 0,
    retry: false,
  });

  if (input.parameter.kind !== "resource-select") {
    return null;
  }

  const resourceOptions = [...(resourceQuery.data?.items ?? [])].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
  const placeholder =
    input.connectionId.trim().length === 0
      ? `Select ${input.parameter.label}`
      : resourceQuery.isPending
        ? "Loading..."
        : resourceOptions.length === 0
          ? `No ${input.parameter.label}s available`
          : `Select ${input.parameter.label}`;

  return (
    <span className="flex items-center gap-2">
      <span className="text-muted-foreground text-sm">
        {input.parameter.prefix ?? input.parameter.label}
      </span>
      <Select
        onValueChange={(value) => {
          if (value === null) {
            return;
          }

          input.onValueChange(value === "__any__" ? "" : value);
        }}
        value={input.value.length === 0 ? "__any__" : input.value}
      >
        <SelectTrigger className="h-8 min-w-44 rounded-md border-0 bg-muted/50 px-2.5 text-sm">
          <SelectValue placeholder={placeholder}>
            {resourceOptions.find((option) => option.handle === input.value)?.displayName ??
              (input.value.length === 0 ? `Any ${input.parameter.label}` : undefined)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__any__">{`Any ${input.parameter.label}`}</SelectItem>
          {resourceOptions.map((option) => (
            <SelectItem key={`${input.eventType}:${option.id}`} value={option.handle}>
              {option.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  );
}
