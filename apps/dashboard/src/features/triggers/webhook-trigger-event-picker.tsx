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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useComboboxAnchor,
  Notice,
} from "@mistle/ui";
import { InfoIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import { SingleSelectStringComboboxField } from "../forms/single-select-string-combobox-field.js";
import { IntegrationLogo } from "../integrations/integration-logo.js";
import { listIntegrationConnectionResources } from "../integrations/integrations-service.js";
import { isWebhookTriggerEventOptionUnavailable } from "./webhook-trigger-event-option-availability.js";
import {
  resolveSelectedWebhookTriggerEventOptions,
  resolveWebhookTriggerEventPickerState,
  type WebhookTriggerEventPickerDisabledState,
} from "./webhook-trigger-event-picker-state.js";
import type {
  WebhookTriggerEventOption,
  WebhookTriggerEventParameterValueMap,
} from "./webhook-trigger-event-types.js";

const EventParameterRowClassName = "flex w-full items-center gap-4";
const EventParameterLabelClassName = "text-muted-foreground shrink-0 text-sm whitespace-nowrap";
const EventParameterControlClassName = "min-w-0 flex-1";

export function WebhookTriggerEventPicker(input: {
  hasConnectedIntegrations: boolean;
  selectedConnectionId: string;
  selectedEventIds: readonly string[];
  eventOptions: readonly WebhookTriggerEventOption[];
  disabledState?: WebhookTriggerEventPickerDisabledState | null;
  eventParameterValues: WebhookTriggerEventParameterValueMap;
  error: string | undefined;
  onValueChange: (value: string[]) => void;
  onEventParameterValueChange: (input: {
    triggerId: string;
    parameterId: string;
    value: string;
  }) => void;
  showAddTriggerControl?: boolean;
}): React.JSX.Element {
  const pickerState = resolveWebhookTriggerEventPickerState({
    hasConnectedIntegrations: input.hasConnectedIntegrations,
    selectedEventIds: input.selectedEventIds,
    eventOptions: input.eventOptions,
    ...(input.disabledState === undefined ? {} : { disabledState: input.disabledState }),
  });
  const selectedEventOptions = resolveSelectedWebhookTriggerEventOptions({
    eventOptions: input.eventOptions,
    selectedEventIds: input.selectedEventIds,
  });
  const emptyStateMessage = input.error === undefined ? "No events added yet." : input.error;

  return (
    <div className="space-y-3">
      {input.showAddTriggerControl === false ? null : (
        <WebhookTriggerEventPickerAddButton
          error={input.error}
          eventOptions={input.eventOptions}
          hasConnectedIntegrations={input.hasConnectedIntegrations}
          onValueChange={input.onValueChange}
          selectedEventIds={input.selectedEventIds}
          variant="inline"
        />
      )}

      {pickerState.helperMessage === null ? null : (
        <Notice variant={pickerState.helperVariant}>{pickerState.helperMessage}</Notice>
      )}

      {selectedEventOptions.length === 0 ? (
        pickerState.disabled ? null : (
          <Notice variant={input.error === undefined ? "default" : "alert"}>
            {emptyStateMessage}
          </Notice>
        )
      ) : (
        <div className="space-y-1.5">
          {selectedEventOptions.map((option) => (
            <div
              className={
                isWebhookTriggerEventOptionUnavailable(option)
                  ? "bg-destructive/5 flex flex-col gap-4 rounded-lg border border-destructive/40 px-3.5 py-3"
                  : "bg-muted/20 flex flex-col gap-4 rounded-lg border px-3.5 py-3"
              }
              key={option.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 self-start">
                  <div className="flex min-w-0 items-start gap-2.5">
                    {option.logoKey === undefined ? null : (
                      <IntegrationLogo
                        alt=""
                        className="mt-0.5 size-4 shrink-0"
                        logoKey={option.logoKey}
                      />
                    )}
                    <p className="min-w-0 text-sm leading-5 font-medium text-balance">
                      {option.label}
                    </p>
                  </div>
                </div>
                <Button
                  aria-label={`Remove ${option.label} event`}
                  className="size-7 shrink-0 self-start"
                  onClick={() => {
                    input.onValueChange(
                      input.selectedEventIds.filter(
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
              {option.parameters?.map((parameter) => (
                <EventParameterField
                  connectionId={input.selectedConnectionId}
                  eventType={option.eventType}
                  key={`${option.id}:${parameter.id}`}
                  onValueChange={(value) => {
                    input.onEventParameterValueChange({
                      triggerId: option.id,
                      parameterId: parameter.id,
                      value,
                    });
                  }}
                  parameter={parameter}
                  value={input.eventParameterValues[option.id]?.[parameter.id] ?? ""}
                />
              ))}
              {isWebhookTriggerEventOptionUnavailable(option) &&
              option.description !== undefined ? (
                <p className="text-destructive text-sm">{option.description}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function WebhookTriggerEventPickerAddButton(input: {
  hasConnectedIntegrations: boolean;
  selectedEventIds: readonly string[];
  eventOptions: readonly WebhookTriggerEventOption[];
  disabledState?: WebhookTriggerEventPickerDisabledState | null;
  error?: string | undefined;
  onValueChange: (value: string[]) => void;
  variant?: "inline" | "header";
}): React.JSX.Element {
  const pickerState = resolveWebhookTriggerEventPickerState({
    hasConnectedIntegrations: input.hasConnectedIntegrations,
    selectedEventIds: input.selectedEventIds,
    eventOptions: input.eventOptions,
    ...(input.disabledState === undefined ? {} : { disabledState: input.disabledState }),
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
      value={[...input.selectedEventIds]}
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
            Add event
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

      {isOpen ? (
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
                    <IntegrationLogo alt="" className="size-3.5 shrink-0" logoKey={group.logoKey} />
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
      ) : null}
    </Combobox>
  );
}

function EventParameterField(input: {
  connectionId: string;
  eventType: string;
  parameter: NonNullable<WebhookTriggerEventOption["parameters"]>[number];
  value: string;
  onValueChange: (value: string) => void;
}): React.JSX.Element | null {
  const resourceQuery = useQuery({
    queryKey: [
      "trigger-trigger-parameters",
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
    if (input.parameter.controlVariant === "invocation-token") {
      return (
        <span className={EventParameterRowClassName}>
          <span className={`${EventParameterLabelClassName} flex items-center gap-1`}>
            <span>includes</span>
            <Tooltip delay={0}>
              <TooltipTrigger
                aria-label="Explain invocation token filter"
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
                Example: @mistlebot, mistle, /triage. Leave blank to match all events.
              </TooltipContent>
            </Tooltip>
          </span>
          <Input
            className={EventParameterControlClassName}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              input.onValueChange(event.currentTarget.value);
            }}
            placeholder={input.parameter.placeholder}
            value={input.value}
          />
        </span>
      );
    }

    return (
      <span className={EventParameterRowClassName}>
        <span className={EventParameterLabelClassName}>
          {input.parameter.prefix ?? input.parameter.label}
        </span>
        <Input
          className={EventParameterControlClassName}
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
      <span className={EventParameterRowClassName}>
        <span className={EventParameterLabelClassName}>
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
          <SelectTrigger className={EventParameterControlClassName}>
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
  const normalizedResourceOptions =
    input.value.trim().length > 0 && selectedResourceOption === undefined
      ? [
          ...resourceOptions,
          {
            id: `missing:${input.value}`,
            handle: input.value,
            displayName: `${input.value} (Unavailable)`,
          },
        ]
      : resourceOptions;
  const resolvedSelectedResourceOption =
    selectedResourceOption ??
    normalizedResourceOptions.find((option) => option.handle === input.value);
  const placeholder =
    input.connectionId.trim().length === 0
      ? `Select ${input.parameter.label}`
      : resourceQuery.isPending
        ? "Loading..."
        : normalizedResourceOptions.length === 0
          ? `No ${input.parameter.label}s available`
          : `Select ${input.parameter.label}`;
  return (
    <ResourceSelectParameterField
      key={`${input.connectionId}:${input.value}:${resolvedSelectedResourceOption?.displayName ?? ""}`}
      onValueChange={input.onValueChange}
      parameter={input.parameter}
      placeholder={placeholder}
      resourceOptions={normalizedResourceOptions}
      value={input.value}
    />
  );
}

function ResourceSelectParameterField(input: {
  parameter: Extract<
    NonNullable<WebhookTriggerEventOption["parameters"]>[number],
    { kind: "resource-select" }
  >;
  value: string;
  placeholder: string;
  resourceOptions: Array<{
    id: string;
    handle: string;
    displayName: string;
  }>;
  onValueChange: (value: string) => void;
}): React.JSX.Element {
  const inputId = useId();

  return (
    <span className={EventParameterRowClassName}>
      <span className={EventParameterLabelClassName}>
        {input.parameter.prefix ?? input.parameter.label}
      </span>
      <SingleSelectStringComboboxField
        contentClassName="w-[min(22rem,calc(100vw-2rem))]"
        inputId={inputId}
        inputLabel={input.parameter.label}
        inputWrapperClassName={EventParameterControlClassName}
        onChange={(value) => {
          input.onValueChange(value ?? "");
        }}
        options={input.resourceOptions.map((option) => ({
          value: option.handle,
          label: option.displayName,
        }))}
        placeholder={input.value.length === 0 ? `Any ${input.parameter.label}` : input.placeholder}
        value={input.value.length === 0 ? undefined : input.value}
      />
    </span>
  );
}
