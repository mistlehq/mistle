import {
  Button,
  Combobox,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useComboboxAnchor,
} from "@mistle/ui";
import { InfoIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";

import { listIntegrationConnectionResources } from "../integrations/integrations-service.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import { StatusBox } from "../shared/status-box.js";
import {
  createSyntheticWebhookAutomationEventOption,
  isWebhookAutomationEventOptionUnavailable,
} from "./webhook-automation-event-option-availability.js";
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
      ...createSyntheticWebhookAutomationEventOption({
        triggerId,
        availability: "missing_integration",
      }),
    } satisfies WebhookAutomationEventOption;
  });
}

function resolveWebhookAutomationTriggerPickerState(input: {
  hasConnectedIntegrations: boolean;
  selectedTriggerIds: readonly string[];
  eventOptions: readonly WebhookAutomationEventOption[];
  disabledReason?: string | null;
}): WebhookAutomationTriggerPickerState {
  if (input.disabledReason !== undefined && input.disabledReason !== null) {
    return {
      availableEventOptions: [],
      groupedAvailableEventOptions: [],
      disabled: true,
      helperMessage: input.disabledReason,
      inputPlaceholder: "No triggers available",
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
  disabledReason?: string | null;
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
    ...(input.disabledReason === undefined ? {} : { disabledReason: input.disabledReason }),
  });
  const selectedEventOptions = resolveSelectedWebhookAutomationEventOptions({
    eventOptions: input.eventOptions,
    selectedTriggerIds: input.selectedTriggerIds,
  });
  const emptyStateMessage = input.error === undefined ? "No triggers added yet." : input.error;

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
        <StatusBox tone="destructive">{pickerState.helperMessage}</StatusBox>
      )}

      {selectedEventOptions.length === 0 ? (
        pickerState.disabled ? null : (
          <StatusBox tone={input.error === undefined ? "neutral" : "destructive"}>
            {emptyStateMessage}
          </StatusBox>
        )
      ) : (
        <div className="space-y-1.5">
          {selectedEventOptions.map((option) => (
            <div
              className={
                isWebhookAutomationEventOptionUnavailable(option)
                  ? "bg-destructive/5 flex flex-col gap-3 rounded-lg border border-destructive/40 px-3.5 py-2 md:grid md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-start md:gap-x-3 md:gap-y-2"
                  : "bg-muted/20 flex flex-col gap-3 rounded-lg border px-3.5 py-2 md:grid md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-start md:gap-x-3 md:gap-y-2"
              }
              key={option.id}
            >
              <div className="min-w-0 self-start md:col-start-1 md:row-start-1 md:self-center">
                <div className="flex min-w-0 items-center gap-2.5">
                  {option.logoKey === undefined ? null : (
                    <img
                      alt=""
                      aria-hidden
                      className="size-4 shrink-0"
                      src={resolveIntegrationLogoPath({ logoKey: option.logoKey })}
                    />
                  )}
                  <p className="text-sm leading-none font-medium whitespace-nowrap">
                    {option.label}
                  </p>
                </div>
              </div>
              {option.parameters?.map((parameter, index) => (
                <div
                  className="w-full md:col-start-2 md:w-auto md:justify-self-end"
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
              {isWebhookAutomationEventOptionUnavailable(option) &&
              option.description !== undefined ? (
                <p
                  className="text-destructive text-sm md:col-start-1 md:self-end"
                  style={{ gridRowStart: Math.max(option.parameters?.length ?? 0, 2) }}
                >
                  {option.description}
                </p>
              ) : null}
              <Button
                aria-label={`Remove ${option.label} trigger`}
                className="size-7 shrink-0 self-end md:col-start-3 md:row-start-1 md:self-center"
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
  disabledReason?: string | null;
  error?: string | undefined;
  onValueChange: (value: string[]) => void;
  variant?: "inline" | "header";
}): React.JSX.Element {
  const pickerState = resolveWebhookAutomationTriggerPickerState({
    hasConnectedIntegrations: input.hasConnectedIntegrations,
    selectedTriggerIds: input.selectedTriggerIds,
    eventOptions: input.eventOptions,
    ...(input.disabledReason === undefined ? {} : { disabledReason: input.disabledReason }),
  });
  const [isOpen, setIsOpen] = useState(false);
  const [isSingleTriggerDialogOpen, setIsSingleTriggerDialogOpen] = useState(false);
  const anchorRef = useComboboxAnchor();
  const triggerPickerId = useId();

  return (
    <Combobox<string, true>
      autoHighlight
      disabled={pickerState.disabled}
      multiple
      onOpenChange={setIsOpen}
      onValueChange={(value) => {
        const nextTriggerId = value.find(
          (candidate) => !input.selectedTriggerIds.includes(candidate),
        );

        if (
          input.selectedTriggerIds.length > 0 &&
          nextTriggerId !== undefined &&
          !input.selectedTriggerIds.includes(nextTriggerId)
        ) {
          setIsOpen(false);
          setIsSingleTriggerDialogOpen(true);
          return;
        }

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

      <Dialog onOpenChange={setIsSingleTriggerDialogOpen} open={isSingleTriggerDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader variant="sectioned">
            <DialogTitle>Only one trigger is supported</DialogTitle>
            <DialogDescription>
              Automations currently support only one trigger. Remove the existing trigger before
              adding a different one.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => {
                setIsSingleTriggerDialogOpen(false);
              }}
              type="button"
              variant="outline"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  const [lastNonEmptyStringValue, setLastNonEmptyStringValue] = useState(() => input.value.trim());

  useEffect(() => {
    const nextValue = input.value.trim();
    if (nextValue.length === 0) {
      return;
    }

    setLastNonEmptyStringValue(nextValue);
  }, [input.value]);

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
    if (input.parameter.controlVariant === "explicit-invocation") {
      const switchId = `${input.eventType}:${input.parameter.id}`;
      const defaultExplicitInvocationValue = input.parameter.defaultValue ?? "@mistlebot";
      const savedExplicitInvocationValue = input.value.trim();
      const explicitInvocationValue =
        savedExplicitInvocationValue.length > 0
          ? savedExplicitInvocationValue
          : lastNonEmptyStringValue.length > 0
            ? lastNonEmptyStringValue
            : defaultExplicitInvocationValue;
      const checked = input.value.trim().length > 0;
      const tooltipMessage = `Enable this to respond only when ${explicitInvocationValue} is mentioned. Disable it to respond to every event.`;

      return (
        <div className="inline-flex items-center gap-3 rounded-md border px-3 py-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="block text-sm">
              Only respond to <span className="font-medium">{explicitInvocationValue}</span>
            </span>
            <Tooltip>
              <TooltipTrigger
                aria-label="Explain explicit mention requirement"
                render={
                  <button
                    className="text-muted-foreground hover:text-foreground inline-flex size-4 shrink-0 items-center justify-center rounded-sm"
                    type="button"
                  />
                }
              >
                <InfoIcon aria-hidden className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent className="max-w-64 text-left" side="top">
                {tooltipMessage}
              </TooltipContent>
            </Tooltip>
          </span>
          <Switch
            aria-label={`Only respond to ${explicitInvocationValue}`}
            checked={checked}
            id={switchId}
            onCheckedChange={(nextChecked) => {
              input.onValueChange(nextChecked ? explicitInvocationValue : "");
            }}
          />
        </div>
      );
    }

    return (
      <span className="flex w-full items-center justify-between gap-2 md:w-auto md:justify-end">
        <span className="text-muted-foreground shrink-0 text-sm whitespace-nowrap">
          {input.parameter.prefix ?? input.parameter.label}
        </span>
        <Input
          className="min-w-0 flex-1 md:min-w-32 md:flex-none"
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
      <span className="flex w-full items-center justify-between gap-2 md:w-auto md:justify-end">
        <span className="text-muted-foreground shrink-0 text-sm whitespace-nowrap">
          {input.parameter.prefix ?? input.parameter.label}
        </span>
        <Select
          modal={false}
          onValueChange={(value) => {
            if (value === null) {
              input.onValueChange("");
              return;
            }

            input.onValueChange(value === "__any__" ? "" : value);
          }}
          value={input.value.length === 0 ? null : input.value}
        >
          <SelectTrigger className="min-w-0 flex-1 md:min-w-44 md:flex-none">
            <SelectValue
              placeholder={input.parameter.placeholder ?? `Any ${input.parameter.label}`}
            >
              {input.parameter.options.find((option) => option.value === input.value)?.label}
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
    <span className="flex w-full items-center justify-between gap-2 md:w-auto md:justify-end">
      <span className="text-muted-foreground shrink-0 text-sm whitespace-nowrap">
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
        <div className="min-w-0 flex-1 md:min-w-44 md:flex-none" ref={resourceAnchorRef}>
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
