import {
  Button,
  Combobox,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useComboboxAnchor,
} from "@mistle/ui";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import { listIntegrationConnectionResources } from "../integrations/integrations-service.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import type {
  WebhookAutomationEventOption,
  WebhookAutomationTriggerParameterValueMap,
} from "./webhook-automation-trigger-types.js";

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
  inputPlaceholder: string;
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
      id: triggerId,
      eventType: triggerId,
      connectionId: "",
      connectionLabel: "",
      label: triggerId,
      description: "No longer available from your connected integrations.",
      category: "Unavailable",
      unavailable: true,
    } satisfies WebhookAutomationEventOption;
  });
}

function resolveWebhookAutomationTriggerPickerState(input: {
  hasConnectedIntegrations: boolean;
  selectedTriggerIds: readonly string[];
  eventOptions: readonly WebhookAutomationEventOption[];
}): WebhookAutomationTriggerPickerState {
  const selectedTriggerIdSet = new Set(input.selectedTriggerIds);
  const availableEventOptions = input.eventOptions.filter(
    (option) => option.unavailable !== true && !selectedTriggerIdSet.has(option.id),
  );
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
  selectedTriggerIds: readonly string[];
  eventOptions: readonly WebhookAutomationEventOption[];
  triggerParameterValues: WebhookAutomationTriggerParameterValueMap;
  error: string | undefined;
  onValueChange: (value: string[]) => void;
  onTriggerParameterValueChange: (input: {
    triggerId: string;
    parameterId: string;
    value: string;
  }) => void;
  showAddTriggerControl?: boolean;
}): React.JSX.Element {
  const pickerState = resolveWebhookAutomationTriggerPickerState({
    hasConnectedIntegrations: input.hasConnectedIntegrations,
    selectedTriggerIds: input.selectedTriggerIds,
    eventOptions: input.eventOptions,
  });
  const selectedEventOptions = resolveSelectedWebhookAutomationEventOptions({
    eventOptions: input.eventOptions,
    selectedTriggerIds: input.selectedTriggerIds,
  });

  return (
    <div className="space-y-3">
      {input.showAddTriggerControl === false ? null : (
        <WebhookAutomationTriggerPickerAddButton
          error={input.error}
          eventOptions={input.eventOptions}
          hasConnectedIntegrations={input.hasConnectedIntegrations}
          onValueChange={input.onValueChange}
          selectedTriggerIds={input.selectedTriggerIds}
          variant="inline"
        />
      )}

      {pickerState.helperMessage === null ? null : (
        <p className="text-muted-foreground text-sm">{pickerState.helperMessage}</p>
      )}

      {selectedEventOptions.length === 0 ? (
        <p className="text-muted-foreground text-sm">No triggers added yet.</p>
      ) : (
        <div className="space-y-1.5">
          {selectedEventOptions.map((option) => (
            <div
              className="bg-muted/20 grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-3 gap-y-2 rounded-lg border px-3.5 py-2"
              key={option.id}
            >
              <div className="col-start-1 row-start-1 flex min-w-0 self-center items-center gap-2.5">
                {option.logoKey === undefined ? null : (
                  <img
                    alt=""
                    aria-hidden
                    className="size-4 shrink-0"
                    src={resolveIntegrationLogoPath({ logoKey: option.logoKey })}
                  />
                )}
                <p className="text-sm leading-none font-medium whitespace-nowrap">{option.label}</p>
                {option.unavailable === true ? (
                  <span className="text-destructive text-xs whitespace-nowrap">Unavailable</span>
                ) : null}
              </div>
              {option.parameters?.map((parameter, index) => (
                <div
                  className="col-start-2 justify-self-end"
                  key={`${option.id}:${parameter.id}`}
                  style={{ gridRowStart: index + 1 }}
                >
                  <TriggerParameterField
                    connectionId={input.selectedConnectionId}
                    eventType={option.eventType}
                    onValueChange={(value) => {
                      input.onTriggerParameterValueChange({
                        triggerId: option.id,
                        parameterId: parameter.id,
                        value,
                      });
                    }}
                    parameter={parameter}
                    value={input.triggerParameterValues[option.id]?.[parameter.id] ?? ""}
                  />
                </div>
              ))}
              <Button
                aria-label={`Remove ${option.label} trigger`}
                className="col-start-3 row-start-1 size-7 shrink-0 self-center"
                onClick={() => {
                  input.onValueChange(
                    input.selectedTriggerIds.filter(
                      (selectedTriggerId) => selectedTriggerId !== option.id,
                    ),
                  );
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
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

export function WebhookAutomationTriggerPickerAddButton(input: {
  hasConnectedIntegrations: boolean;
  selectedTriggerIds: readonly string[];
  eventOptions: readonly WebhookAutomationEventOption[];
  error?: string | undefined;
  onValueChange: (value: string[]) => void;
  variant?: "inline" | "header";
}): React.JSX.Element {
  const pickerState = resolveWebhookAutomationTriggerPickerState({
    hasConnectedIntegrations: input.hasConnectedIntegrations,
    selectedTriggerIds: input.selectedTriggerIds,
    eventOptions: input.eventOptions,
  });
  const [isOpen, setIsOpen] = useState(false);
  const anchorRef = useComboboxAnchor();
  const triggerPickerId = useId();

  return (
    <Combobox<string, true>
      autoHighlight
      disabled={pickerState.disabled}
      multiple
      onOpenChange={setIsOpen}
      onValueChange={(value) => {
        input.onValueChange(value);
        setIsOpen(false);
      }}
      open={isOpen}
      value={[...input.selectedTriggerIds]}
    >
      <div ref={anchorRef}>
        {input.variant === "header" ? (
          <Button
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            disabled={pickerState.disabled}
            onClick={() => {
              setIsOpen((open) => !open);
            }}
            type="button"
            variant="outline"
          >
            <PlusIcon aria-hidden className="size-4" />
            Add trigger
          </Button>
        ) : (
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
        )}
      </div>

      <ComboboxContent
        align={input.variant === "header" ? "end" : "start"}
        anchor={anchorRef}
        className="w-[min(34rem,calc(100vw-2rem))] p-0"
      >
        {input.variant === "header" ? (
          <div className="border-b p-1">
            <ComboboxInput
              aria-invalid={input.error === undefined ? undefined : true}
              className="w-full"
              disabled={pickerState.disabled}
              id={triggerPickerId}
              placeholder="Search triggers"
              showClear={false}
            />
          </div>
        ) : null}
        <ComboboxList className="max-h-80">
          {pickerState.groupedAvailableEventOptions.map((group) => (
            <ComboboxGroup key={group.connectionLabel}>
              <ComboboxLabel className="flex items-center gap-2">
                {group.logoKey === undefined ? null : (
                  <img
                    alt=""
                    aria-hidden
                    className="size-3.5 shrink-0"
                    src={resolveIntegrationLogoPath({ logoKey: group.logoKey })}
                  />
                )}
                <span>{group.connectionLabel}</span>
              </ComboboxLabel>
              {group.items.map((option) => (
                <ComboboxItem key={option.id} value={option.id}>
                  <span className="truncate">{option.label}</span>
                </ComboboxItem>
              ))}
            </ComboboxGroup>
          ))}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
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
    queryKey: [
      "automation-trigger-parameters",
      input.connectionId,
      input.parameter.kind === "resource-select" ? input.parameter.resourceKind : "none",
    ],
    queryFn: async ({ signal }) => {
      if (
        input.parameter.kind !== "resource-select" ||
        input.parameter.resourceKind === undefined
      ) {
        throw new Error("Resource parameter is missing resource kind.");
      }

      return listIntegrationConnectionResources({
        connectionId: input.connectionId,
        kind: input.parameter.resourceKind,
        signal,
      });
    },
    enabled:
      input.parameter.kind === "resource-select" &&
      input.parameter.resourceKind !== undefined &&
      input.connectionId.trim().length > 0,
    retry: false,
  });

  if (input.parameter.kind === "string") {
    return (
      <span className="flex shrink-0 items-center justify-end gap-2 whitespace-nowrap">
        <span className="text-muted-foreground text-sm whitespace-nowrap">
          {input.parameter.prefix ?? input.parameter.label}
        </span>
        <Input
          className="min-w-32"
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            input.onValueChange(event.currentTarget.value);
          }}
          placeholder={input.parameter.placeholder ?? input.parameter.label}
          value={input.value}
        />
      </span>
    );
  }

  if (input.parameter.kind === "enum-select") {
    return (
      <span className="flex shrink-0 items-center justify-end gap-2 whitespace-nowrap">
        <span className="text-muted-foreground text-sm whitespace-nowrap">
          {input.parameter.prefix ?? input.parameter.label}
        </span>
        <Select
          modal={false}
          onValueChange={(value) => {
            if (value === null) {
              return;
            }

            input.onValueChange(value === "__any__" ? "" : value);
          }}
          value={input.value.length === 0 ? "__any__" : input.value}
        >
          <SelectTrigger className="min-w-44">
            <SelectValue
              placeholder={input.parameter.placeholder ?? `Any ${input.parameter.label}`}
            >
              {input.parameter.options.find((option) => option.value === input.value)?.label ??
                (input.value.length === 0
                  ? (input.parameter.placeholder ?? `Any ${input.parameter.label}`)
                  : undefined)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__any__">
              {input.parameter.placeholder ?? `Any ${input.parameter.label}`}
            </SelectItem>
            {input.parameter.options.map((option) => (
              <SelectItem key={`${input.eventType}:${option.value}`} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
    );
  }

  const resourceOptions = [...(resourceQuery.data?.items ?? [])].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
  const selectedResourceOption = resourceOptions.find((option) => option.handle === input.value);
  const placeholder =
    input.connectionId.trim().length === 0
      ? `Select ${input.parameter.label}`
      : resourceQuery.isPending
        ? "Loading..."
        : resourceOptions.length === 0
          ? `No ${input.parameter.label}s available`
          : `Select ${input.parameter.label}`;
  return (
    <ResourceSelectParameterField
      key={`${input.connectionId}:${input.value}:${selectedResourceOption?.displayName ?? ""}`}
      eventType={input.eventType}
      onValueChange={input.onValueChange}
      parameter={input.parameter}
      placeholder={placeholder}
      resourceOptions={resourceOptions}
      selectedDisplayName={selectedResourceOption?.displayName ?? ""}
      value={input.value}
    />
  );
}

function ResourceSelectParameterField(input: {
  eventType: string;
  parameter: Extract<
    NonNullable<WebhookAutomationEventOption["parameters"]>[number],
    { kind: "resource-select" }
  >;
  value: string;
  placeholder: string;
  selectedDisplayName: string;
  resourceOptions: Array<{
    id: string;
    handle: string;
    displayName: string;
  }>;
  onValueChange: (value: string) => void;
}): React.JSX.Element {
  const resourceAnchorRef = useComboboxAnchor();
  const [resourceQueryText, setResourceQueryText] = useState(input.selectedDisplayName);

  return (
    <span className="flex shrink-0 items-center justify-end gap-2 whitespace-nowrap">
      <span className="text-muted-foreground text-sm whitespace-nowrap">
        {input.parameter.prefix ?? input.parameter.label}
      </span>
      <Combobox<string>
        autoHighlight
        items={input.resourceOptions.map((option) => ({
          value: option.handle,
          label: option.displayName,
        }))}
        inputValue={resourceQueryText}
        onInputValueChange={setResourceQueryText}
        onOpenChange={(open) => {
          if (!open) {
            setResourceQueryText(input.selectedDisplayName);
          }
        }}
        onValueChange={(value) => {
          const nextSelectedResourceOption = input.resourceOptions.find(
            (option) => option.handle === value,
          );
          setResourceQueryText(nextSelectedResourceOption?.displayName ?? "");
          input.onValueChange(value ?? "");
        }}
        value={input.value.length === 0 ? null : input.value}
      >
        <div className="min-w-44" ref={resourceAnchorRef}>
          <ComboboxInput
            className="w-full"
            placeholder={
              input.value.length === 0 ? `Any ${input.parameter.label}` : input.placeholder
            }
            showClear={input.value.length > 0}
          />
        </div>
        <ComboboxContent
          align="start"
          anchor={resourceAnchorRef}
          className="w-[min(22rem,calc(100vw-2rem))] p-0"
        >
          <ComboboxList className="max-h-64">
            {input.resourceOptions.map((option) => (
              <ComboboxItem key={`${input.eventType}:${option.id}`} value={option.handle}>
                <span className="truncate">{option.displayName}</span>
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </span>
  );
}
