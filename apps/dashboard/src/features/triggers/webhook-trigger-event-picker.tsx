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
import { ArrowClockwiseIcon, InfoIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FocusEvent, useId, useRef, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  IntegrationConnectionResourcePickerView,
  toIntegrationConnectionResourcePickerItems,
  type IntegrationConnectionResourcePickerItem,
} from "../forms/integration-connection-resource-picker-view.js";
import type { IntegrationResourceListViewState } from "../forms/integration-resource-picker-view-model.js";
import {
  filterStringComboboxOptions,
  resolveStringComboboxOption,
  type StringComboboxOption,
} from "../forms/string-combobox-options.js";
import { IntegrationLogo } from "../integrations/integration-logo.js";
import {
  listIntegrationConnectionResources,
  refreshIntegrationConnectionResources,
} from "../integrations/integrations-service.js";
import { TriggerFormFieldError } from "./trigger-form-shell.js";
import { isWebhookTriggerEventOptionUnavailable } from "./webhook-trigger-event-option-availability.js";
import {
  resolveSelectedWebhookTriggerEventOptions,
  resolveWebhookTriggerEventPickerState,
  type WebhookTriggerEventPickerDisabledState,
} from "./webhook-trigger-event-picker-state.js";
import type {
  WebhookTriggerEventOption,
  WebhookTriggerEventParameterGroup,
  WebhookTriggerEventParameterRule,
  WebhookTriggerEventParameterRuleMap,
} from "./webhook-trigger-event-types.js";
import { WebhookTriggerEventParameterRuleOperators } from "./webhook-trigger-event-types.js";
import type { WebhookTriggerEventParameterFieldError } from "./webhook-trigger-form-types.js";
import { createWebhookTriggerEventConditionId } from "./webhook-trigger-option-builders.js";

const EventParameterRowClassName = "flex w-full items-center gap-4";
const EventParameterLabelClassName = "text-muted-foreground shrink-0 text-sm whitespace-nowrap";
const EventParameterControlClassName = "min-w-0 flex-1";
const ResourceSyncPollIntervalMs = 3_000;

type WebhookTriggerEventParameter = NonNullable<WebhookTriggerEventOption["parameters"]>[number];

type ResolvedOneOfParameterGroupOption = {
  parameter: WebhookTriggerEventParameter;
  label: string;
};

type StringWebhookTriggerEventParameter = Extract<WebhookTriggerEventParameter, { kind: "string" }>;

type EnumSelectWebhookTriggerEventParameter = Extract<
  WebhookTriggerEventParameter,
  { kind: "enum-select" }
>;

type ResourceSelectWebhookTriggerEventParameter = Extract<
  WebhookTriggerEventParameter,
  { kind: "resource-select" }
>;

type ResourceParameterOption = {
  id: string;
  handle: string;
  displayName: string;
};

function createTriggerParameterResourceQueryKey(input: {
  connectionId: string;
  resourceKind: string;
}): readonly ["trigger-trigger-parameters", string, string] {
  return ["trigger-trigger-parameters", input.connectionId, input.resourceKind];
}

export function WebhookTriggerEventPicker(input: {
  hasConnectedIntegrations: boolean;
  selectedConnectionId: string;
  selectedEventIds: readonly string[];
  eventOptions: readonly WebhookTriggerEventOption[];
  disabledState?: WebhookTriggerEventPickerDisabledState | null;
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
  error: string | undefined;
  eventParameterError?: WebhookTriggerEventParameterFieldError;
  onValueChange?: (value: string[]) => void;
  onEventParameterRuleChange: (input: {
    triggerId: string;
    parameterId: string;
    rule: WebhookTriggerEventParameterRule;
  }) => void;
  onEventParameterRulesChange: (input: {
    triggerId: string;
    rules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>;
  }) => void;
  selectedEventPresentation?: "cards" | "parameters-only";
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
  const selectedEventControlsDisabled =
    input.disabledState !== undefined && input.disabledState !== null;

  function handleValueChange(value: string[]): void {
    if (selectedEventControlsDisabled) {
      return;
    }

    if (input.onValueChange === undefined) {
      throw new Error(
        "Webhook trigger event picker value changes require an onValueChange handler.",
      );
    }

    input.onValueChange(value);
  }

  return (
    <div className="space-y-3">
      {input.showAddTriggerControl === false ? null : (
        <WebhookTriggerEventPickerAddButton
          error={input.error}
          eventOptions={input.eventOptions}
          hasConnectedIntegrations={input.hasConnectedIntegrations}
          onValueChange={handleValueChange}
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
      ) : input.selectedEventPresentation === "parameters-only" ? (
        <div className="space-y-3">
          {selectedEventOptions.map((option) => (
            <div className="space-y-3" key={option.id}>
              <EventParameterFields
                connectionId={input.selectedConnectionId}
                disabled={selectedEventControlsDisabled}
                eventOption={option}
                {...(input.eventParameterError === undefined
                  ? {}
                  : { eventParameterError: input.eventParameterError })}
                rules={input.eventParameterRules[option.id] ?? {}}
                onRuleChange={(parameterId, rule) => {
                  input.onEventParameterRuleChange({
                    triggerId: option.id,
                    parameterId,
                    rule,
                  });
                }}
                onRulesChange={(rules) => {
                  input.onEventParameterRulesChange({
                    triggerId: option.id,
                    rules,
                  });
                }}
              />
              {isWebhookTriggerEventOptionUnavailable(option) &&
              option.description !== undefined ? (
                <p className="text-destructive text-sm">{option.description}</p>
              ) : null}
            </div>
          ))}
        </div>
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
                  disabled={selectedEventControlsDisabled}
                  onClick={() => {
                    handleValueChange(
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
              <EventParameterFields
                connectionId={input.selectedConnectionId}
                disabled={selectedEventControlsDisabled}
                eventOption={option}
                {...(input.eventParameterError === undefined
                  ? {}
                  : { eventParameterError: input.eventParameterError })}
                rules={input.eventParameterRules[option.id] ?? {}}
                onRuleChange={(parameterId, rule) => {
                  input.onEventParameterRuleChange({
                    triggerId: option.id,
                    parameterId,
                    rule,
                  });
                }}
                onRulesChange={(rules) => {
                  input.onEventParameterRulesChange({
                    triggerId: option.id,
                    rules,
                  });
                }}
              />
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

function findParameter(
  parameters: readonly WebhookTriggerEventParameter[],
  parameterId: string,
): WebhookTriggerEventParameter | undefined {
  return parameters.find((parameter) => parameter.id === parameterId);
}

function resolveParameterRuleValues(rule: WebhookTriggerEventParameterRule | undefined): string[] {
  const configuredValues = rule?.values?.filter((value) => value.trim().length > 0) ?? [];
  const configuredValue = rule?.value.trim() ?? "";

  if (configuredValues.length > 0) {
    return [...configuredValues];
  }

  return configuredValue.length === 0 ? [] : [configuredValue];
}

function findParameterGroupForParameter(input: {
  groups: readonly WebhookTriggerEventParameterGroup[];
  parameterId: string;
}): WebhookTriggerEventParameterGroup | undefined {
  return input.groups.find((group) =>
    group.options.some((option) => option.parameterId === input.parameterId),
  );
}

function resolveOneOfParameterGroupOptions(input: {
  group: WebhookTriggerEventParameterGroup;
  parameters: readonly WebhookTriggerEventParameter[];
}): ResolvedOneOfParameterGroupOption[] {
  return input.group.options.map((option) => {
    const parameter = findParameter(input.parameters, option.parameterId);
    if (parameter === undefined) {
      throw new Error(
        `Trigger event parameter group '${input.group.id}' references missing parameter '${option.parameterId}'.`,
      );
    }

    if (!isEqualityParameter(parameter)) {
      throw new Error(
        `Trigger event parameter group '${input.group.id}' references non-equality parameter '${option.parameterId}'.`,
      );
    }

    return {
      parameter,
      label: option.label,
    };
  });
}

function EventParameterFields(input: {
  connectionId: string;
  disabled: boolean;
  eventOption: WebhookTriggerEventOption;
  eventParameterError?: WebhookTriggerEventParameterFieldError;
  rules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>;
  onRuleChange: (parameterId: string, rule: WebhookTriggerEventParameterRule) => void;
  onRulesChange: (rules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>) => void;
}): React.JSX.Element {
  const parameters = input.eventOption.parameters ?? [];
  const parameterGroups = input.eventOption.parameterGroups ?? [];
  const renderedGroupIds = new Set<string>();

  return (
    <>
      {parameters.map((parameter) => {
        const parameterGroup = findParameterGroupForParameter({
          groups: parameterGroups,
          parameterId: parameter.id,
        });

        if (parameterGroup !== undefined) {
          if (renderedGroupIds.has(parameterGroup.id)) {
            return null;
          }

          renderedGroupIds.add(parameterGroup.id);
          return (
            <OneOfParameterGroupField
              connectionId={input.connectionId}
              disabled={input.disabled}
              eventType={input.eventOption.eventType}
              group={parameterGroup}
              key={`${input.eventOption.id}:group:${parameterGroup.id}`}
              onRuleChange={input.onRuleChange}
              onRulesChange={input.onRulesChange}
              parameters={parameters}
              rules={input.rules}
            />
          );
        }

        return (
          <EventParameterField
            connectionId={input.connectionId}
            disabled={input.disabled}
            eventType={input.eventOption.eventType}
            key={`${input.eventOption.id}:${parameter.id}`}
            {...(input.eventParameterError?.triggerId === input.eventOption.id &&
            input.eventParameterError.parameterId === parameter.id
              ? { errorMessage: input.eventParameterError.message }
              : {})}
            onRuleChange={(rule) => {
              input.onRuleChange(parameter.id, rule);
            }}
            parameter={parameter}
            rule={input.rules[parameter.id]}
          />
        );
      })}
    </>
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

  function appendCondition(eventOptionId: string): void {
    let index = input.selectedEventIds.length;
    let conditionId = createWebhookTriggerEventConditionId({
      eventOptionId,
      index,
    });
    while (input.selectedEventIds.includes(conditionId)) {
      index += 1;
      conditionId = createWebhookTriggerEventConditionId({
        eventOptionId,
        index,
      });
    }

    input.onValueChange([...input.selectedEventIds, conditionId]);
  }

  return (
    <Combobox<string, true>
      autoHighlight
      disabled={pickerState.disabled}
      multiple
      onOpenChange={setIsOpen}
      onValueChange={(value) => {
        const selectedEventOptionId = value.find((item) =>
          input.eventOptions.some((option) => option.id === item),
        );
        if (selectedEventOptionId !== undefined) {
          appendCondition(selectedEventOptionId);
        }
        setIsOpen(false);
      }}
      open={isOpen}
      value={[]}
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
            Add condition
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

function normalizeResourceParameterOptions(input: {
  items: readonly ResourceParameterOption[];
  markMissingSelectedOptionsUnavailable: boolean;
  selectedValues: readonly string[];
}): ResourceParameterOption[] {
  const sortedOptions = sortResourceParameterOptions(input.items);
  const missingSelectedOptions = input.selectedValues
    .filter(
      (selectedValue) =>
        selectedValue.trim().length > 0 &&
        sortedOptions.every((option) => option.handle !== selectedValue),
    )
    .map((selectedValue) => ({
      id: `missing:${selectedValue}`,
      handle: selectedValue,
      displayName: input.markMissingSelectedOptionsUnavailable
        ? `${selectedValue} (Unavailable)`
        : selectedValue,
    }));

  return [...sortedOptions, ...missingSelectedOptions];
}

function sortResourceParameterOptions(
  items: readonly ResourceParameterOption[],
): ResourceParameterOption[] {
  return [...items].sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function useTriggerParameterResources(input: {
  connectionId: string;
  resourceKind: string | undefined;
  selectedValues: readonly string[];
}) {
  const resourceQueryKey = createTriggerParameterResourceQueryKey({
    connectionId: input.connectionId,
    resourceKind: input.resourceKind ?? "none",
  });
  const resourceQuery = useQuery({
    queryKey: resourceQueryKey,
    queryFn: async ({ signal }) => {
      if (input.resourceKind === undefined) {
        throw new Error("Resource parameter is missing resource kind.");
      }

      return listIntegrationConnectionResources({
        connectionId: input.connectionId,
        kind: input.resourceKind,
        signal,
      });
    },
    enabled: input.resourceKind !== undefined && input.connectionId.trim().length > 0,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.syncState === "syncing" ? ResourceSyncPollIntervalMs : false,
  });
  const availableResourceOptions = sortResourceParameterOptions(resourceQuery.data?.items ?? []);
  const unavailableSelectedValues =
    resourceQuery.data === undefined
      ? []
      : input.selectedValues.filter(
          (selectedValue) =>
            selectedValue.trim().length > 0 &&
            availableResourceOptions.every((option) => option.handle !== selectedValue),
        );
  const normalizedResourceOptions = normalizeResourceParameterOptions({
    items: availableResourceOptions,
    markMissingSelectedOptionsUnavailable: resourceQuery.data !== undefined,
    selectedValues: input.selectedValues,
  });
  const resourceErrorMessage = resolveResourceParameterErrorMessage({
    isError: resourceQuery.isError,
    error: resourceQuery.error,
    syncState: resourceQuery.data?.syncState,
    lastErrorMessage: resourceQuery.data?.lastErrorMessage,
  });

  return {
    availableResourceOptions,
    normalizedResourceOptions,
    resourceErrorMessage,
    resourceQuery,
    resourceQueryKey,
    unavailableSelectedValues,
  };
}

function findConfiguredOneOfParameterId(input: {
  options: readonly ResolvedOneOfParameterGroupOption[];
  rules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>;
}): string {
  const configuredOption = input.options.find((option) => {
    const rule = input.rules[option.parameter.id];
    return resolveParameterRuleValues(rule).length > 0;
  });

  return configuredOption?.parameter.id ?? input.options[0]?.parameter.id ?? "";
}

export function resolveOneOfParameterGroupRulesAfterSelection(input: {
  group: WebhookTriggerEventParameterGroup;
  rules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>;
  selectedParameterId: string;
}): NonNullable<WebhookTriggerEventParameterRuleMap[string]> {
  if (!input.group.options.some((option) => option.parameterId === input.selectedParameterId)) {
    throw new Error(
      `Trigger event parameter group '${input.group.id}' does not contain parameter '${input.selectedParameterId}'.`,
    );
  }

  const nextRules = { ...input.rules };
  for (const option of input.group.options) {
    if (option.parameterId === input.selectedParameterId) {
      continue;
    }

    nextRules[option.parameterId] = {
      operator: WebhookTriggerEventParameterRuleOperators.IS,
      value: "",
    };
  }

  return nextRules;
}

function StringEqualityParameterValueField(input: {
  disabled: boolean;
  parameter: StringWebhookTriggerEventParameter;
  rule: WebhookTriggerEventParameterRule | undefined;
  value: string;
  onRuleChange: (rule: WebhookTriggerEventParameterRule) => void;
}): React.JSX.Element {
  return (
    <Input
      className={EventParameterControlClassName}
      disabled={input.disabled}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
        input.onRuleChange({
          operator: resolveEqualityOperator(input.rule),
          value: event.currentTarget.value,
        });
      }}
      placeholder={input.parameter.placeholder ?? input.parameter.label}
      value={input.value}
    />
  );
}

function EnumSelectParameterValueField(input: {
  disabled: boolean;
  eventType: string;
  parameter: EnumSelectWebhookTriggerEventParameter;
  value: string;
  onRuleChange: (rule: WebhookTriggerEventParameterRule) => void;
}): React.JSX.Element {
  return (
    <Select
      disabled={input.disabled}
      modal={false}
      onValueChange={(value) => {
        input.onRuleChange(
          resolveEnumSelectParameterRule({
            parameter: input.parameter,
            value,
          }),
        );
      }}
      value={input.value.length === 0 ? null : input.value}
    >
      <SelectTrigger className={EventParameterControlClassName} disabled={input.disabled}>
        <SelectValue placeholder={input.parameter.placeholder ?? `Any ${input.parameter.label}`}>
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
  );
}

function OneOfParameterGroupField(input: {
  connectionId: string;
  disabled: boolean;
  eventType: string;
  group: WebhookTriggerEventParameterGroup;
  parameters: readonly WebhookTriggerEventParameter[];
  rules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>;
  onRuleChange: (parameterId: string, rule: WebhookTriggerEventParameterRule) => void;
  onRulesChange: (rules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>) => void;
}): React.JSX.Element {
  const inputId = useId();
  const groupOptions = resolveOneOfParameterGroupOptions({
    group: input.group,
    parameters: input.parameters,
  });
  const [selectedParameterId, setSelectedParameterId] = useState(
    findConfiguredOneOfParameterId({
      options: groupOptions,
      rules: input.rules,
    }),
  );
  const selectedOption = groupOptions.find((option) => option.parameter.id === selectedParameterId);
  if (selectedOption === undefined) {
    throw new Error(
      `Trigger event parameter group '${input.group.id}' has no selected parameter option.`,
    );
  }

  const selectedParameter = selectedOption.parameter;
  const selectedRule = input.rules[selectedParameter.id];
  const selectedValue = selectedRule?.value ?? "";
  const selectedPrefixLabel = selectedParameter.prefix ?? selectedParameter.label;
  const selectedResources = useTriggerParameterResources({
    connectionId: input.connectionId,
    resourceKind:
      selectedParameter.kind === "resource-select" ? selectedParameter.resourceKind : undefined,
    selectedValues: resolveParameterRuleValues(selectedRule),
  });

  function clearInactiveRules(parameterId: string): void {
    input.onRulesChange(
      resolveOneOfParameterGroupRulesAfterSelection({
        group: input.group,
        rules: input.rules,
        selectedParameterId: parameterId,
      }),
    );
  }

  return (
    <div className={EventParameterRowClassName}>
      <Select
        disabled={input.disabled}
        modal={false}
        onValueChange={(value) => {
          if (value === null) {
            return;
          }

          if (!groupOptions.some((option) => option.parameter.id === value)) {
            return;
          }

          setSelectedParameterId(value);
          clearInactiveRules(value);
        }}
        value={selectedParameter.id}
      >
        <SelectTrigger className="w-36 shrink-0" disabled={input.disabled}>
          <SelectValue>{selectedOption.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {groupOptions.map((option) => (
            <SelectItem
              key={`${input.group.id}:${option.parameter.id}`}
              value={option.parameter.id}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isEqualityParameter(selectedParameter) ? (
        <EqualityOperatorSelect
          disabled={input.disabled}
          includePrefix={false}
          parameter={selectedParameter}
          value={resolveEqualityOperator(selectedRule)}
          onValueChange={(operator) => {
            input.onRuleChange(selectedParameter.id, {
              operator,
              value: selectedValue,
              ...(selectedParameter.kind === "resource-select" &&
              selectedParameter.multiValue === true &&
              selectedRule?.values !== undefined
                ? { values: selectedRule.values }
                : {}),
            });
          }}
        />
      ) : selectedOption.label === selectedPrefixLabel ? null : (
        <span className="text-muted-foreground w-36 shrink-0 text-sm">{selectedPrefixLabel}</span>
      )}
      {selectedParameter.kind === "resource-select" ? (
        <div className={`${EventParameterControlClassName} space-y-1.5`}>
          {selectedParameter.multiValue === true ? (
            <ResourceMultiSelectParameterField
              key={`${input.connectionId}:${resolveParameterRuleValues(selectedRule).join("\u0000")}`}
              connectionId={input.connectionId}
              disabled={input.disabled}
              onRuleChange={(rule) => {
                input.onRuleChange(selectedParameter.id, rule);
              }}
              parameter={selectedParameter}
              placeholder={
                selectedResources.resourceQuery.isPending
                  ? "Loading..."
                  : selectedResources.resourceErrorMessage !== null
                    ? `Could not load ${selectedParameter.label}s`
                    : selectedResources.normalizedResourceOptions.length === 0
                      ? `No ${selectedParameter.label}s available`
                      : (selectedParameter.placeholder ?? `Any ${selectedParameter.label}`)
              }
              rule={selectedRule}
              resourceQueryKey={selectedResources.resourceQueryKey}
              resourceErrorMessage={selectedResources.resourceErrorMessage}
              resourceOptions={selectedResources.availableResourceOptions}
              resourceQueryIsError={selectedResources.resourceQuery.isError}
              resourceQueryIsPending={selectedResources.resourceQuery.isPending}
              syncState={selectedResources.resourceQuery.data?.syncState}
              unavailableSelectedValues={selectedResources.unavailableSelectedValues}
              showOperator={false}
            />
          ) : (
            <ResourceSelectParameterCombobox
              connectionId={input.connectionId}
              contentClassName="w-[min(22rem,calc(100vw-2rem))]"
              disabled={input.disabled}
              inputId={inputId}
              inputLabel={selectedParameter.label}
              inputWrapperClassName="w-full"
              onChange={(value) => {
                input.onRuleChange(selectedParameter.id, {
                  operator: resolveEqualityOperator(selectedRule),
                  value: value ?? "",
                });
              }}
              options={selectedResources.normalizedResourceOptions}
              placeholder={
                selectedResources.resourceQuery.isPending
                  ? "Loading..."
                  : selectedResources.resourceErrorMessage !== null
                    ? `Could not load ${selectedParameter.label}s`
                    : selectedResources.normalizedResourceOptions.length === 0
                      ? `No ${selectedParameter.label}s available`
                      : (selectedParameter.placeholder ?? `Any ${selectedParameter.label}`)
              }
              emptyMessage={
                selectedResources.resourceErrorMessage ?? `No matching ${selectedParameter.label}s.`
              }
              parameterLabel={selectedParameter.label}
              resourceKind={selectedParameter.resourceKind}
              resourceQueryKey={selectedResources.resourceQueryKey}
              syncState={selectedResources.resourceQuery.data?.syncState}
              value={selectedValue.length === 0 ? undefined : selectedValue}
            />
          )}
          {selectedResources.resourceErrorMessage === null ? null : (
            <Notice variant="alert">{selectedResources.resourceErrorMessage}</Notice>
          )}
        </div>
      ) : selectedParameter.kind === "string" ? (
        <StringEqualityParameterValueField
          parameter={selectedParameter}
          rule={selectedRule}
          value={selectedValue}
          disabled={input.disabled}
          onRuleChange={(rule) => {
            input.onRuleChange(selectedParameter.id, {
              operator: rule.operator,
              value: rule.value,
            });
          }}
        />
      ) : (
        <EnumSelectParameterValueField
          eventType={input.eventType}
          parameter={selectedParameter}
          value={selectedValue}
          disabled={input.disabled}
          onRuleChange={(rule) => {
            input.onRuleChange(selectedParameter.id, rule);
          }}
        />
      )}
    </div>
  );
}

function resolveResourceParameterErrorMessage(input: {
  isError: boolean;
  error: unknown;
  syncState: string | undefined;
  lastErrorMessage: string | undefined;
}): string | null {
  if (input.isError) {
    return resolveApiErrorMessage({
      error: input.error,
      fallbackMessage: "Could not load resources for this connection.",
    });
  }

  if (input.syncState === "error") {
    return input.lastErrorMessage ?? "Could not sync resources for this connection.";
  }

  return null;
}

function EventParameterField(input: {
  connectionId: string;
  disabled: boolean;
  eventType: string;
  errorMessage?: string;
  parameter: NonNullable<WebhookTriggerEventOption["parameters"]>[number];
  rule: WebhookTriggerEventParameterRule | undefined;
  onRuleChange: (rule: WebhookTriggerEventParameterRule) => void;
}): React.JSX.Element | null {
  const value = input.rule?.value ?? "";
  const multiValues = resolveParameterRuleValues(input.rule);
  const resources = useTriggerParameterResources({
    connectionId: input.connectionId,
    resourceKind:
      input.parameter.kind === "resource-select" ? input.parameter.resourceKind : undefined,
    selectedValues:
      input.parameter.kind === "resource-select" && input.parameter.multiValue === true
        ? multiValues
        : [value],
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
          <span className={`${EventParameterControlClassName} space-y-2`}>
            <Input
              aria-invalid={input.errorMessage === undefined ? undefined : true}
              aria-label={input.parameter.label}
              disabled={input.disabled}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                input.onRuleChange({
                  operator: WebhookTriggerEventParameterRuleOperators.CONTAINS_TOKEN,
                  value: event.currentTarget.value,
                });
              }}
              placeholder={input.parameter.placeholder}
              value={value}
            />
            <TriggerFormFieldError message={input.errorMessage} />
          </span>
        </span>
      );
    }

    if (isEqualityParameter(input.parameter)) {
      return (
        <span className={EventParameterRowClassName}>
          <EqualityOperatorSelect
            disabled={input.disabled}
            parameter={input.parameter}
            value={resolveEqualityOperator(input.rule)}
            onValueChange={(operator) => {
              input.onRuleChange({
                operator,
                value,
              });
            }}
          />
          <StringEqualityParameterValueField
            parameter={input.parameter}
            rule={input.rule}
            value={value}
            disabled={input.disabled}
            onRuleChange={input.onRuleChange}
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
          disabled={input.disabled}
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
        <EnumSelectParameterValueField
          eventType={input.eventType}
          parameter={parameter}
          value={value}
          disabled={input.disabled}
          onRuleChange={input.onRuleChange}
        />
      </span>
    );
  }

  const resolvedSelectedResourceOption = resources.normalizedResourceOptions.find(
    (option) => option.handle === value,
  );
  const placeholder =
    input.connectionId.trim().length === 0
      ? `Select ${input.parameter.label}`
      : resources.resourceQuery.isPending
        ? "Loading..."
        : resources.normalizedResourceOptions.length === 0
          ? `No ${input.parameter.label}s available`
          : `Select ${input.parameter.label}`;
  if (input.parameter.multiValue === true) {
    return (
      <ResourceMultiSelectParameterField
        key={`${input.connectionId}:${multiValues.join("\u0000")}`}
        connectionId={input.connectionId}
        disabled={input.disabled}
        onRuleChange={input.onRuleChange}
        parameter={input.parameter}
        placeholder={placeholder}
        rule={input.rule}
        resourceQueryKey={resources.resourceQueryKey}
        resourceErrorMessage={resources.resourceErrorMessage}
        resourceOptions={resources.availableResourceOptions}
        resourceQueryIsError={resources.resourceQuery.isError}
        resourceQueryIsPending={resources.resourceQuery.isPending}
        syncState={resources.resourceQuery.data?.syncState}
        unavailableSelectedValues={resources.unavailableSelectedValues}
        showOperator={isEqualityParameter(input.parameter)}
      />
    );
  }

  return (
    <ResourceSelectParameterField
      key={`${input.connectionId}:${value}:${resolvedSelectedResourceOption?.displayName ?? ""}`}
      connectionId={input.connectionId}
      disabled={input.disabled}
      onRuleChange={input.onRuleChange}
      parameter={input.parameter}
      placeholder={placeholder}
      rule={input.rule}
      resourceQueryKey={resources.resourceQueryKey}
      resourceOptions={resources.normalizedResourceOptions}
      syncState={resources.resourceQuery.data?.syncState}
    />
  );
}

function ResourceMultiSelectParameterField(input: {
  connectionId: string;
  disabled: boolean;
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
  resourceErrorMessage: string | null;
  resourceQueryKey: readonly ["trigger-trigger-parameters", string, string];
  resourceQueryIsError: boolean;
  resourceQueryIsPending: boolean;
  syncState: string | undefined;
  unavailableSelectedValues: readonly string[];
  onRuleChange: (rule: WebhookTriggerEventParameterRule) => void;
  showOperator?: boolean;
}): React.JSX.Element {
  const inputId = useId();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const showOperator = input.showOperator ?? true;
  const selectedValues = resolveParameterRuleValues(input.rule);
  const resourceLabel = formatRefreshResourceLabel(input.parameter.label);
  const pickerItems = toIntegrationConnectionResourcePickerItems(input.resourceOptions);
  const visiblePickerItems = filterIntegrationConnectionResourcePickerItems(pickerItems, search);
  const refreshLabel = `Refresh ${resourceLabel}`;
  const refreshMutation = useMutation({
    mutationFn: async () =>
      refreshIntegrationConnectionResources({
        connectionId: input.connectionId,
        kind: input.parameter.resourceKind,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: input.resourceQueryKey,
      });
    },
  });
  const refreshErrorMessage =
    refreshMutation.error === null || refreshMutation.error === undefined
      ? null
      : resolveApiErrorMessage({
          error: refreshMutation.error,
          fallbackMessage: `Could not refresh ${resourceLabel}.`,
        });
  const listState: IntegrationResourceListViewState = input.resourceQueryIsPending
    ? {
        mode: "loading",
      }
    : input.resourceQueryIsError
      ? {
          mode: "error",
          message: input.resourceErrorMessage ?? `Could not load ${resourceLabel}.`,
        }
      : {
          mode: "ready",
        };
  const isRefreshing = refreshMutation.isPending || input.syncState === "syncing";

  return (
    <span className={EventParameterRowClassName}>
      {showOperator ? (
        <EqualityOperatorSelect
          disabled={input.disabled}
          parameter={input.parameter}
          value={resolveEqualityOperator(input.rule)}
          onValueChange={(operator) => {
            input.onRuleChange({
              operator,
              value: "",
              values: selectedValues,
            });
          }}
        />
      ) : (
        <span className={EventParameterLabelClassName}>
          {input.parameter.prefix ?? input.parameter.label}
        </span>
      )}
      <div className={EventParameterControlClassName}>
        <IntegrationConnectionResourcePickerView
          density="compact"
          disabled={input.disabled}
          emptyMessage={`No ${resourceLabel} available for this connection.`}
          id={inputId}
          isRefreshing={isRefreshing}
          label={input.parameter.label}
          listState={listState}
          onBlur={() => {}}
          onFocus={() => {}}
          onRefresh={() => {
            refreshMutation.mutate();
          }}
          onSearchChange={setSearch}
          onSelectionChange={(values) => {
            input.onRuleChange({
              operator: resolveEqualityOperator(input.rule),
              value: "",
              values,
            });
          }}
          refreshErrorMessage={refreshErrorMessage}
          refreshLabel={refreshLabel}
          refreshTooltip={refreshLabel}
          resourceLabelPlural={resourceLabel}
          search={search}
          searchPlaceholder={input.placeholder}
          selectedValues={selectedValues}
          unavailableSelectedValues={input.unavailableSelectedValues}
          visibleItems={visiblePickerItems}
        />
      </div>
    </span>
  );
}

function filterIntegrationConnectionResourcePickerItems(
  items: readonly IntegrationConnectionResourcePickerItem[],
  search: string,
): IntegrationConnectionResourcePickerItem[] {
  const normalizedSearch = search.trim().toLowerCase();
  if (normalizedSearch.length === 0) {
    return [...items];
  }

  return items.filter((item) => {
    const haystack = `${item.label} ${item.value}`.toLowerCase();
    return haystack.includes(normalizedSearch);
  });
}

export function resolveEnumSelectParameterRule(input: {
  parameter: Extract<
    NonNullable<WebhookTriggerEventOption["parameters"]>[number],
    { kind: "enum-select" }
  >;
  value: string | null;
}): WebhookTriggerEventParameterRule {
  const selectedValue = input.value === null || input.value === "__any__" ? "" : input.value;

  if (input.parameter.matchMode === "eq" || input.parameter.matchMode === "payload_filter") {
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
    (parameter.kind === "resource-select" &&
      (parameter.matchMode === undefined || parameter.matchMode === "eq")) ||
    (parameter.kind === "string" &&
      (parameter.matchMode === undefined || parameter.matchMode === "eq")) ||
    (parameter.kind === "enum-select" && parameter.matchMode === "eq")
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
  includePrefix: boolean;
}): string {
  const prefix = input.includePrefix ? input.parameter.prefix : undefined;
  if (input.operator === WebhookTriggerEventParameterRuleOperators.IS) {
    return prefix ?? "is";
  }

  return prefix === undefined ? "is not" : `not ${prefix}`;
}

function EqualityOperatorSelect(input: {
  disabled: boolean;
  parameter: NonNullable<WebhookTriggerEventOption["parameters"]>[number];
  value: "is" | "is_not";
  includePrefix?: boolean;
  onValueChange: (operator: "is" | "is_not") => void;
}): React.JSX.Element {
  const includePrefix = input.includePrefix ?? true;

  return (
    <Select
      disabled={input.disabled}
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
      <SelectTrigger className="w-24 shrink-0" disabled={input.disabled}>
        <SelectValue>
          {formatEqualityOperatorLabel({
            parameter: input.parameter,
            operator: input.value,
            includePrefix,
          })}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={WebhookTriggerEventParameterRuleOperators.IS}>
          {formatEqualityOperatorLabel({
            parameter: input.parameter,
            operator: WebhookTriggerEventParameterRuleOperators.IS,
            includePrefix,
          })}
        </SelectItem>
        <SelectItem value={WebhookTriggerEventParameterRuleOperators.IS_NOT}>
          {formatEqualityOperatorLabel({
            parameter: input.parameter,
            operator: WebhookTriggerEventParameterRuleOperators.IS_NOT,
            includePrefix,
          })}
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

function formatRefreshResourceLabel(parameterLabel: string): string {
  const trimmedLabel = parameterLabel.trim();
  if (trimmedLabel.length === 0) {
    return "resources";
  }

  const lastSpaceIndex = trimmedLabel.lastIndexOf(" ");
  const labelPrefix = lastSpaceIndex === -1 ? "" : trimmedLabel.slice(0, lastSpaceIndex + 1);
  const noun = lastSpaceIndex === -1 ? trimmedLabel : trimmedLabel.slice(lastSpaceIndex + 1);

  if (noun.endsWith("y")) {
    return `${labelPrefix}${noun.slice(0, -1)}ies`;
  }

  if (noun.endsWith("ch") || noun.endsWith("sh") || noun.endsWith("x") || noun.endsWith("z")) {
    return `${labelPrefix}${noun}es`;
  }

  if (noun.endsWith("s")) {
    return trimmedLabel;
  }

  return `${labelPrefix}${noun}s`;
}

function toStringComboboxOptions(
  resourceOptions: readonly ResourceParameterOption[],
): StringComboboxOption[] {
  return resourceOptions.map((option) => ({
    value: option.handle,
    label: option.displayName,
  }));
}

function ResourceRefreshFooter(input: {
  connectionId: string;
  disabled: boolean;
  parameterLabel: string;
  resourceKind: string;
  resourceQueryKey: readonly ["trigger-trigger-parameters", string, string];
  syncState: string | undefined;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const resourceLabel = formatRefreshResourceLabel(input.parameterLabel);
  const refreshLabel = `Refresh ${resourceLabel}`;
  const refreshMutation = useMutation({
    mutationFn: async () =>
      refreshIntegrationConnectionResources({
        connectionId: input.connectionId,
        kind: input.resourceKind,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: input.resourceQueryKey,
      });
    },
  });

  const refreshErrorMessage =
    refreshMutation.error === null || refreshMutation.error === undefined
      ? null
      : resolveApiErrorMessage({
          error: refreshMutation.error,
          fallbackMessage: `Could not refresh ${resourceLabel}.`,
        });
  const refreshIsPending = refreshMutation.isPending || input.syncState === "syncing";

  return (
    <div className="border-t p-1">
      <Button
        aria-label={refreshLabel}
        className="w-full justify-start gap-2"
        disabled={input.disabled || refreshIsPending}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          refreshMutation.mutate();
        }}
        type="button"
        variant="ghost"
      >
        <ArrowClockwiseIcon
          aria-hidden
          className={refreshIsPending ? "size-4 animate-spin" : "size-4"}
        />
        {refreshIsPending ? `Refreshing ${resourceLabel}` : refreshLabel}
      </Button>
      {refreshErrorMessage === null ? null : (
        <p className="text-destructive px-2 pt-1 pb-0.5 text-xs">{refreshErrorMessage}</p>
      )}
    </div>
  );
}

function ResourceSelectParameterCombobox(input: {
  connectionId: string;
  contentClassName?: string | undefined;
  disabled: boolean;
  emptyMessage: string;
  inputId: string;
  inputLabel: string;
  inputWrapperClassName: string;
  onChange: (value: string | undefined) => void;
  options: readonly ResourceParameterOption[];
  parameterLabel: string;
  placeholder: string;
  resourceKind: string;
  resourceQueryKey: readonly ["trigger-trigger-parameters", string, string];
  syncState: string | undefined;
  value: string | undefined;
}): React.JSX.Element {
  const selectedValue = typeof input.value === "string" ? input.value : "";
  const options = toStringComboboxOptions(input.options);
  const selectedOption = resolveStringComboboxOption(options, selectedValue);
  const [isOpen, setIsOpen] = useState(false);
  const [queryText, setQueryText] = useState(selectedOption?.label ?? "");
  const anchorRef = useComboboxAnchor();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const disabled = input.disabled;
  const showClear = selectedValue.length > 0;
  const filteredOptions = filterStringComboboxOptions(options, queryText);

  function focusIsWithinCombobox(nextFocusedElement: EventTarget | null): boolean {
    if (!(nextFocusedElement instanceof Node)) {
      return false;
    }

    return (
      anchorRef.current?.contains(nextFocusedElement) === true ||
      contentRef.current?.contains(nextFocusedElement) === true
    );
  }

  function handleComboboxInputBlur(event: FocusEvent<HTMLInputElement>): void {
    if (focusIsWithinCombobox(event.relatedTarget)) {
      return;
    }

    setIsOpen(false);
  }

  function handleComboboxContentBlur(event: FocusEvent<HTMLDivElement>): void {
    if (focusIsWithinCombobox(event.relatedTarget)) {
      return;
    }

    setIsOpen(false);
  }

  return (
    <Combobox<string>
      autoHighlight
      disabled={disabled}
      inputValue={isOpen ? queryText : (selectedOption?.label ?? "")}
      onInputValueChange={setQueryText}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) {
          setQueryText("");
        } else {
          setQueryText("");
        }
      }}
      onValueChange={(value) => {
        setQueryText("");
        input.onChange(value ?? undefined);
      }}
      open={isOpen}
      value={selectedValue.length === 0 ? null : selectedValue}
    >
      <div className={input.inputWrapperClassName} ref={anchorRef}>
        <ComboboxInput
          aria-label={input.inputLabel}
          className="w-full"
          disabled={disabled}
          id={input.inputId}
          onBlur={handleComboboxInputBlur}
          onFocus={() => {
            setQueryText("");
            setIsOpen(true);
          }}
          placeholder={input.placeholder}
          showClear={showClear}
        />
      </div>
      {isOpen ? (
        <ComboboxContent
          anchor={anchorRef}
          className={input.contentClassName === undefined ? "p-0" : `p-0 ${input.contentClassName}`}
          onBlur={handleComboboxContentBlur}
          ref={contentRef}
        >
          <ComboboxList>
            {filteredOptions.map((option) => (
              <ComboboxItem key={option.value} value={option.value}>
                <span className="truncate">{option.label}</span>
              </ComboboxItem>
            ))}
            {filteredOptions.length === 0 ? (
              <div className="text-muted-foreground py-2 text-center text-sm">
                {input.emptyMessage}
              </div>
            ) : null}
          </ComboboxList>
          <ResourceRefreshFooter
            connectionId={input.connectionId}
            disabled={disabled}
            parameterLabel={input.parameterLabel}
            resourceKind={input.resourceKind}
            resourceQueryKey={input.resourceQueryKey}
            syncState={input.syncState}
          />
        </ComboboxContent>
      ) : null}
    </Combobox>
  );
}

function ResourceSelectParameterField(input: {
  connectionId: string;
  disabled: boolean;
  parameter: ResourceSelectWebhookTriggerEventParameter;
  rule: WebhookTriggerEventParameterRule | undefined;
  placeholder: string;
  resourceOptions: ResourceParameterOption[];
  resourceQueryKey: readonly ["trigger-trigger-parameters", string, string];
  syncState: string | undefined;
  onRuleChange: (rule: WebhookTriggerEventParameterRule) => void;
}): React.JSX.Element {
  const inputId = useId();
  const value = input.rule?.value ?? "";

  return (
    <span className={EventParameterRowClassName}>
      <EqualityOperatorSelect
        disabled={input.disabled}
        parameter={input.parameter}
        value={resolveEqualityOperator(input.rule)}
        onValueChange={(operator) => {
          input.onRuleChange({
            operator,
            value,
          });
        }}
      />
      <ResourceSelectParameterCombobox
        connectionId={input.connectionId}
        contentClassName="w-[min(22rem,calc(100vw-2rem))]"
        disabled={input.disabled}
        emptyMessage={`No matching ${input.parameter.label}s.`}
        inputId={inputId}
        inputLabel={input.parameter.label}
        inputWrapperClassName={EventParameterControlClassName}
        onChange={(value) => {
          input.onRuleChange({
            operator: resolveEqualityOperator(input.rule),
            value: value ?? "",
          });
        }}
        options={input.resourceOptions}
        parameterLabel={input.parameter.label}
        placeholder={value.length === 0 ? `Any ${input.parameter.label}` : input.placeholder}
        resourceKind={input.parameter.resourceKind}
        resourceQueryKey={input.resourceQueryKey}
        syncState={input.syncState}
        value={value.length === 0 ? undefined : value}
      />
    </span>
  );
}
