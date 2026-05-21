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
  TextLink,
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
  WebhookTriggerEventParameterRule,
  WebhookTriggerEventParameterRuleMap,
} from "./webhook-trigger-event-types.js";
import { WebhookTriggerEventParameterRuleOperators } from "./webhook-trigger-event-types.js";

const EventParameterRowClassName = "flex w-full items-center gap-4";
const EventParameterLabelClassName = "text-muted-foreground shrink-0 text-sm whitespace-nowrap";
const EventParameterControlClassName = "min-w-0 flex-1";

export function WebhookTriggerEventPicker(input: {
  hasConnectedIntegrations: boolean;
  selectedConnectionId: string;
  selectedEventIds: readonly string[];
  eventOptions: readonly WebhookTriggerEventOption[];
  disabledState?: WebhookTriggerEventPickerDisabledState | null;
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
  error: string | undefined;
  onValueChange: (value: string[]) => void;
  onEventParameterRuleChange: (input: {
    triggerId: string;
    parameterId: string;
    rule: WebhookTriggerEventParameterRule;
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

      {pickerState.shouldShowNoAvailableTriggerEventsNotice ? (
        <Notice>
          No trigger events are available yet. Check your integration setup or sync trigger events
          from <TextLink href="/integrations">Integrations</TextLink>.
        </Notice>
      ) : null}

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
                  onRuleChange={(rule) => {
                    input.onEventParameterRuleChange({
                      triggerId: option.id,
                      parameterId: parameter.id,
                      rule,
                    });
                  }}
                  parameter={parameter}
                  rule={input.eventParameterRules[option.id]?.[parameter.id]}
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
  rule: WebhookTriggerEventParameterRule | undefined;
  onRuleChange: (rule: WebhookTriggerEventParameterRule) => void;
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
  const value = input.rule?.value ?? "";

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
              input.onRuleChange({
                operator: WebhookTriggerEventParameterRuleOperators.CONTAINS_TOKEN,
                value: event.currentTarget.value,
              });
            }}
            placeholder={input.parameter.placeholder}
            value={value}
          />
        </span>
      );
    }

    if (isEqualityParameter(input.parameter)) {
      return (
        <span className={EventParameterRowClassName}>
          <EqualityOperatorSelect
            parameter={input.parameter}
            value={resolveEqualityOperator(input.rule)}
            onValueChange={(operator) => {
              input.onRuleChange({
                operator,
                value,
              });
            }}
          />
          <Input
            className={EventParameterControlClassName}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              input.onRuleChange({
                operator: resolveEqualityOperator(input.rule),
                value: event.currentTarget.value,
              });
            }}
            placeholder={input.parameter.placeholder ?? input.parameter.label}
            value={value}
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
            input.onRuleChange({
              operator: WebhookTriggerEventParameterRuleOperators.CONTAINS,
              value: event.currentTarget.value,
            });
          }}
          placeholder={input.parameter.placeholder ?? input.parameter.label}
          value={value}
        />
      </span>
    );
  }

  if (input.parameter.kind === "enum-select") {
    const parameter = input.parameter;
    return (
      <span className={EventParameterRowClassName}>
        <span className={EventParameterLabelClassName}>{parameter.prefix ?? parameter.label}</span>
        <Select
          modal={false}
          onValueChange={(value) => {
            input.onRuleChange(
              resolveEnumSelectParameterRule({
                parameter,
                value,
              }),
            );
          }}
          value={value.length === 0 ? null : value}
        >
          <SelectTrigger className={EventParameterControlClassName}>
            <SelectValue placeholder={parameter.placeholder ?? `Any ${parameter.label}`}>
              {parameter.options.find((option) => option.value === value)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__any__">
              {parameter.placeholder ?? `Any ${parameter.label}`}
            </SelectItem>
            {parameter.options.map((option) => (
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
  const selectedResourceOption = resourceOptions.find((option) => option.handle === value);
  const normalizedResourceOptions =
    value.trim().length > 0 && selectedResourceOption === undefined
      ? [
          ...resourceOptions,
          {
            id: `missing:${value}`,
            handle: value,
            displayName: `${value} (Unavailable)`,
          },
        ]
      : resourceOptions;
  const resolvedSelectedResourceOption =
    selectedResourceOption ?? normalizedResourceOptions.find((option) => option.handle === value);
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
      key={`${input.connectionId}:${value}:${resolvedSelectedResourceOption?.displayName ?? ""}`}
      onRuleChange={input.onRuleChange}
      parameter={input.parameter}
      placeholder={placeholder}
      rule={input.rule}
      resourceOptions={normalizedResourceOptions}
    />
  );
}

export function resolveEnumSelectParameterRule(input: {
  parameter: Extract<
    NonNullable<WebhookTriggerEventOption["parameters"]>[number],
    { kind: "enum-select" }
  >;
  value: string | null;
}): WebhookTriggerEventParameterRule {
  const selectedValue = input.value === null || input.value === "__any__" ? "" : input.value;

  if (input.parameter.matchMode === "eq") {
    return {
      operator: WebhookTriggerEventParameterRuleOperators.IS,
      value: selectedValue,
    };
  }

  return {
    operator:
      selectedValue === WebhookTriggerEventParameterRuleOperators.NOT_EXISTS
        ? WebhookTriggerEventParameterRuleOperators.NOT_EXISTS
        : WebhookTriggerEventParameterRuleOperators.EXISTS,
    value: selectedValue,
  };
}

function isEqualityParameter(
  parameter: NonNullable<WebhookTriggerEventOption["parameters"]>[number],
): boolean {
  return (
    parameter.kind === "resource-select" ||
    (parameter.kind === "string" &&
      (parameter.matchMode === undefined || parameter.matchMode === "eq"))
  );
}

function resolveEqualityOperator(
  rule: WebhookTriggerEventParameterRule | undefined,
): "is" | "is_not" {
  return rule?.operator === WebhookTriggerEventParameterRuleOperators.IS_NOT
    ? WebhookTriggerEventParameterRuleOperators.IS_NOT
    : WebhookTriggerEventParameterRuleOperators.IS;
}

function formatEqualityOperatorLabel(input: {
  parameter: NonNullable<WebhookTriggerEventOption["parameters"]>[number];
  operator: "is" | "is_not";
}): string {
  const prefix = input.parameter.prefix;
  if (input.operator === WebhookTriggerEventParameterRuleOperators.IS) {
    return prefix ?? "is";
  }

  return prefix === undefined ? "is not" : `not ${prefix}`;
}

function EqualityOperatorSelect(input: {
  parameter: NonNullable<WebhookTriggerEventOption["parameters"]>[number];
  value: "is" | "is_not";
  onValueChange: (operator: "is" | "is_not") => void;
}): React.JSX.Element {
  return (
    <Select
      modal={false}
      onValueChange={(value) => {
        if (
          value !== WebhookTriggerEventParameterRuleOperators.IS &&
          value !== WebhookTriggerEventParameterRuleOperators.IS_NOT
        ) {
          return;
        }

        input.onValueChange(value);
      }}
      value={input.value}
    >
      <SelectTrigger className="w-24 shrink-0">
        <SelectValue>
          {formatEqualityOperatorLabel({
            parameter: input.parameter,
            operator: input.value,
          })}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={WebhookTriggerEventParameterRuleOperators.IS}>
          {formatEqualityOperatorLabel({
            parameter: input.parameter,
            operator: WebhookTriggerEventParameterRuleOperators.IS,
          })}
        </SelectItem>
        <SelectItem value={WebhookTriggerEventParameterRuleOperators.IS_NOT}>
          {formatEqualityOperatorLabel({
            parameter: input.parameter,
            operator: WebhookTriggerEventParameterRuleOperators.IS_NOT,
          })}
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

function ResourceSelectParameterField(input: {
  parameter: Extract<
    NonNullable<WebhookTriggerEventOption["parameters"]>[number],
    { kind: "resource-select" }
  >;
  rule: WebhookTriggerEventParameterRule | undefined;
  placeholder: string;
  resourceOptions: Array<{
    id: string;
    handle: string;
    displayName: string;
  }>;
  onRuleChange: (rule: WebhookTriggerEventParameterRule) => void;
}): React.JSX.Element {
  const inputId = useId();
  const value = input.rule?.value ?? "";

  return (
    <span className={EventParameterRowClassName}>
      <EqualityOperatorSelect
        parameter={input.parameter}
        value={resolveEqualityOperator(input.rule)}
        onValueChange={(operator) => {
          input.onRuleChange({
            operator,
            value,
          });
        }}
      />
      <SingleSelectStringComboboxField
        contentClassName="w-[min(22rem,calc(100vw-2rem))]"
        inputId={inputId}
        inputLabel={input.parameter.label}
        inputWrapperClassName={EventParameterControlClassName}
        onChange={(value) => {
          input.onRuleChange({
            operator: resolveEqualityOperator(input.rule),
            value: value ?? "",
          });
        }}
        options={input.resourceOptions.map((option) => ({
          value: option.handle,
          label: option.displayName,
        }))}
        placeholder={value.length === 0 ? `Any ${input.parameter.label}` : input.placeholder}
        value={value.length === 0 ? undefined : value}
      />
    </span>
  );
}
