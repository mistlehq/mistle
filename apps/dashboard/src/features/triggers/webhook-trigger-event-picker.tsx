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

import { resolveApiErrorMessage } from "../api/error-message.js";
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
  WebhookTriggerEventParameterGroup,
  WebhookTriggerEventParameterRule,
  WebhookTriggerEventParameterRuleMap,
} from "./webhook-trigger-event-types.js";
import { WebhookTriggerEventParameterRuleOperators } from "./webhook-trigger-event-types.js";

const EventParameterRowClassName = "flex w-full items-center gap-4";
const EventParameterLabelClassName = "text-muted-foreground shrink-0 text-sm whitespace-nowrap";
const EventParameterControlClassName = "min-w-0 flex-1";

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
  onEventParameterRulesChange: (input: {
    triggerId: string;
    rules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>;
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
              <EventParameterFields
                connectionId={input.selectedConnectionId}
                eventOption={option}
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
  eventOption: WebhookTriggerEventOption;
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
            eventType={input.eventOption.eventType}
            key={`${input.eventOption.id}:${parameter.id}`}
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

type ResourceParameterOption = {
  id: string;
  handle: string;
  displayName: string;
};

function normalizeResourceParameterOptions(input: {
  items: readonly ResourceParameterOption[];
  value: string;
}): ResourceParameterOption[] {
  const sortedOptions = [...input.items].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
  const selectedOption = sortedOptions.find((option) => option.handle === input.value);
  if (input.value.trim().length === 0 || selectedOption !== undefined) {
    return sortedOptions;
  }

  return [
    ...sortedOptions,
    {
      id: `missing:${input.value}`,
      handle: input.value,
      displayName: `${input.value} (Unavailable)`,
    },
  ];
}

function findConfiguredOneOfParameterId(input: {
  options: readonly ResolvedOneOfParameterGroupOption[];
  rules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>;
}): string {
  const configuredOption = input.options.find((option) => {
    const rule = input.rules[option.parameter.id];
    return (rule?.value.trim().length ?? 0) > 0;
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
  parameter: StringWebhookTriggerEventParameter;
  rule: WebhookTriggerEventParameterRule | undefined;
  value: string;
  onRuleChange: (rule: WebhookTriggerEventParameterRule) => void;
}): React.JSX.Element {
  return (
    <Input
      className={EventParameterControlClassName}
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
  eventType: string;
  parameter: EnumSelectWebhookTriggerEventParameter;
  value: string;
  onRuleChange: (rule: WebhookTriggerEventParameterRule) => void;
}): React.JSX.Element {
  return (
    <Select
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
      <SelectTrigger className={EventParameterControlClassName}>
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
  const selectedResourceKind =
    selectedParameter.kind === "resource-select" ? selectedParameter.resourceKind : "none";
  const resourceQuery = useQuery({
    queryKey: ["trigger-trigger-parameters", input.connectionId, selectedResourceKind],
    queryFn: async ({ signal }) => {
      if (selectedParameter.kind !== "resource-select") {
        throw new Error("Resource parameter group option is missing resource kind.");
      }

      return listIntegrationConnectionResources({
        connectionId: input.connectionId,
        kind: selectedParameter.resourceKind,
        signal,
      });
    },
    enabled: selectedParameter.kind === "resource-select" && input.connectionId.trim().length > 0,
    retry: false,
  });
  const normalizedResourceOptions = normalizeResourceParameterOptions({
    items: resourceQuery.data?.items ?? [],
    value: selectedValue,
  });
  const resourceErrorMessage = resolveResourceParameterErrorMessage({
    isError: resourceQuery.isError,
    error: resourceQuery.error,
    syncState: resourceQuery.data?.syncState,
    lastErrorMessage: resourceQuery.data?.lastErrorMessage,
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
        <SelectTrigger className="w-36 shrink-0">
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
      <EqualityOperatorSelect
        includePrefix={false}
        parameter={selectedParameter}
        value={resolveEqualityOperator(selectedRule)}
        onValueChange={(operator) => {
          input.onRuleChange(selectedParameter.id, {
            operator,
            value: selectedValue,
          });
        }}
      />
      {selectedParameter.kind === "resource-select" ? (
        <div className={`${EventParameterControlClassName} space-y-1.5`}>
          <SingleSelectStringComboboxField
            contentClassName="w-[min(22rem,calc(100vw-2rem))]"
            inputId={inputId}
            inputLabel={selectedParameter.label}
            inputWrapperClassName="w-full"
            onChange={(value) => {
              input.onRuleChange(selectedParameter.id, {
                operator: resolveEqualityOperator(selectedRule),
                value: value ?? "",
              });
            }}
            options={normalizedResourceOptions.map((option) => ({
              value: option.handle,
              label: option.displayName,
            }))}
            placeholder={
              resourceQuery.isPending
                ? "Loading..."
                : resourceErrorMessage !== null
                  ? `Could not load ${selectedParameter.label}s`
                  : normalizedResourceOptions.length === 0
                    ? `No ${selectedParameter.label}s available`
                    : (selectedParameter.placeholder ?? `Any ${selectedParameter.label}`)
            }
            emptyMessage={resourceErrorMessage ?? `No matching ${selectedParameter.label}s.`}
            value={selectedValue.length === 0 ? undefined : selectedValue}
          />
          {resourceErrorMessage === null ? null : (
            <Notice variant="alert">{resourceErrorMessage}</Notice>
          )}
        </div>
      ) : selectedParameter.kind === "string" ? (
        <StringEqualityParameterValueField
          parameter={selectedParameter}
          rule={selectedRule}
          value={selectedValue}
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
          <StringEqualityParameterValueField
            parameter={input.parameter}
            rule={input.rule}
            value={value}
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
          onRuleChange={input.onRuleChange}
        />
      </span>
    );
  }

  const normalizedResourceOptions = normalizeResourceParameterOptions({
    items: resourceQuery.data?.items ?? [],
    value,
  });
  const resolvedSelectedResourceOption = normalizedResourceOptions.find(
    (option) => option.handle === value,
  );
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
  parameter: NonNullable<WebhookTriggerEventOption["parameters"]>[number];
  value: "is" | "is_not";
  includePrefix?: boolean;
  onValueChange: (operator: "is" | "is_not") => void;
}): React.JSX.Element {
  const includePrefix = input.includePrefix ?? true;

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
