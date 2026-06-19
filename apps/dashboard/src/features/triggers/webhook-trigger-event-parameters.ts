import type {
  WebhookTriggerEventOption,
  WebhookTriggerEventParameterOption,
  WebhookTriggerEventParameterRuleMap,
} from "./webhook-trigger-event-types.js";
import { WebhookTriggerEventParameterRuleOperators } from "./webhook-trigger-event-types.js";
import { resolveWebhookTriggerEventOptionIdFromConditionId } from "./webhook-trigger-option-builders.js";

type PayloadFilterNode =
  | {
      op: "and";
      filters: PayloadFilterNode[];
    }
  | {
      op: "eq" | "neq" | "contains" | "contains_token";
      path: string[];
      value: string;
    }
  | {
      op: "in";
      path: string[];
      values: string[];
    }
  | {
      op: "exists" | "not_exists";
      path: string[];
    };
type PayloadFilterPathNode = Extract<PayloadFilterNode, { path: string[] }>;

function findEventOptionByTriggerId(input: {
  eventOptions: readonly WebhookTriggerEventOption[];
  triggerId: string;
}): WebhookTriggerEventOption | undefined {
  const eventOptionId = resolveWebhookTriggerEventOptionIdFromConditionId(input.triggerId);
  return input.eventOptions.find((option) => option.id === eventOptionId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseKnownPayloadFilterNode(value: unknown): PayloadFilterNode | null {
  if (!isRecord(value) || typeof value["op"] !== "string") {
    return null;
  }

  if (value["op"] === "and") {
    const filters = value["filters"];
    if (!Array.isArray(filters)) {
      return null;
    }

    const parsedFilters = filters
      .map((filter) => parseKnownPayloadFilterNode(filter))
      .filter((filter): filter is PayloadFilterNode => filter !== null);

    if (parsedFilters.length !== filters.length) {
      return null;
    }

    return {
      op: "and",
      filters: parsedFilters,
    };
  }

  if (value["op"] === "eq" || value["op"] === "neq") {
    if (!isStringArray(value["path"]) || typeof value["value"] !== "string") {
      return null;
    }

    return {
      op: value["op"],
      path: value["path"],
      value: value["value"],
    };
  }

  if (value["op"] === "contains") {
    if (!isStringArray(value["path"]) || typeof value["value"] !== "string") {
      return null;
    }

    return {
      op: "contains",
      path: value["path"],
      value: value["value"],
    };
  }

  if (value["op"] === "contains_token") {
    if (!isStringArray(value["path"]) || typeof value["value"] !== "string") {
      return null;
    }

    return {
      op: "contains_token",
      path: value["path"],
      value: value["value"],
    };
  }

  if (value["op"] === "in") {
    if (!isStringArray(value["path"]) || !isStringArray(value["values"])) {
      return null;
    }

    return {
      op: "in",
      path: value["path"],
      values: value["values"],
    };
  }

  if (value["op"] === "exists" || value["op"] === "not_exists") {
    if (!isStringArray(value["path"])) {
      return null;
    }

    return {
      op: value["op"],
      path: value["path"],
    };
  }

  return null;
}

function buildEqualityNode(input: {
  operator: "is" | "is_not";
  path: string[];
  value: string;
}): PayloadFilterNode {
  return {
    op: input.operator === WebhookTriggerEventParameterRuleOperators.IS_NOT ? "neq" : "eq",
    path: input.path,
    value: input.value,
  };
}

function buildInNode(input: { path: string[]; values: string[] }): PayloadFilterNode {
  return {
    op: "in",
    path: input.path,
    values: input.values,
  };
}

function resolveConfiguredRuleValues(input: {
  value: string | undefined;
  values: readonly string[] | undefined;
}): string[] {
  const configuredValues = input.values?.filter((value) => value.trim().length > 0) ?? [];
  const configuredValue = input.value?.trim() ?? "";

  if (configuredValues.length > 0) {
    return [...configuredValues];
  }

  return configuredValue.length === 0 ? [] : [configuredValue];
}

function buildContainsNode(input: { path: string[]; value: string }): PayloadFilterNode {
  return {
    op: "contains",
    path: input.path,
    value: input.value,
  };
}

function buildContainsTokenNode(input: { path: string[]; value: string }): PayloadFilterNode {
  return {
    op: "contains_token",
    path: input.path,
    value: input.value,
  };
}

function buildExistsNode(input: {
  path: string[];
  operator: "exists" | "not_exists";
}): PayloadFilterNode {
  return {
    op: input.operator,
    path: input.path,
  };
}

function resolveOneOfGroupParameterIds(eventOption: WebhookTriggerEventOption): Set<string> {
  return new Set(
    (eventOption.parameterGroups ?? []).flatMap((group) =>
      group.options.map((option) => option.parameterId),
    ),
  );
}

function resolveActiveOneOfGroupParameterIds(input: {
  eventOption: WebhookTriggerEventOption;
  rules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>;
}): Set<string> {
  const activeParameterIds = new Set<string>();

  for (const group of input.eventOption.parameterGroups ?? []) {
    const configuredParameterIds = group.options
      .filter(
        (option) =>
          resolveConfiguredRuleValues({
            value: input.rules[option.parameterId]?.value,
            values: input.rules[option.parameterId]?.values,
          }).length > 0,
      )
      .map((option) => option.parameterId);

    if (configuredParameterIds.length > 1) {
      throw new Error(
        `Trigger event parameter group '${group.id}' cannot serialize multiple configured options.`,
      );
    }

    const configuredParameterId = configuredParameterIds[0];
    if (configuredParameterId !== undefined) {
      activeParameterIds.add(configuredParameterId);
    }
  }

  return activeParameterIds;
}

function hasNegatedFilterForPath(input: {
  filters: readonly PayloadFilterNode[];
  path: readonly string[];
}): boolean {
  return input.filters.some(
    (filter) =>
      filter.op === "neq" &&
      filter.path.length === input.path.length &&
      filter.path.every((segment, index) => segment === input.path[index]),
  );
}

function payloadPathMatches(input: {
  parameter: WebhookTriggerEventParameterOption;
  filter: PayloadFilterPathNode;
}): boolean {
  return (
    input.parameter.payloadPath.length === input.filter.path.length &&
    input.parameter.payloadPath.every((segment, index) => segment === input.filter.path[index])
  );
}

function isGitHubAppBotHandle(value: string): boolean {
  return value.endsWith("[bot]");
}

function isBotResourceParameter(parameter: WebhookTriggerEventParameterOption): boolean {
  return parameter.kind === "resource-select" && parameter.resourceKind === "bot";
}

function resolvePayloadFilterParameter(input: {
  parameters: readonly WebhookTriggerEventParameterOption[];
  filter: PayloadFilterPathNode;
}): WebhookTriggerEventParameterOption | undefined {
  const matchingParameters = input.parameters.filter((parameter) =>
    payloadPathMatches({ parameter, filter: input.filter }),
  );
  const firstMatchingParameter = matchingParameters[0];
  if (matchingParameters.length <= 1 || firstMatchingParameter === undefined) {
    return firstMatchingParameter;
  }

  if (
    input.filter.op === "eq" ||
    input.filter.op === "neq" ||
    input.filter.op === "contains" ||
    input.filter.op === "contains_token"
  ) {
    const matchingBotParameter = matchingParameters.find((parameter) =>
      isBotResourceParameter(parameter),
    );
    if (matchingBotParameter !== undefined && isGitHubAppBotHandle(input.filter.value)) {
      return matchingBotParameter;
    }

    const matchingNonBotParameter = matchingParameters.find(
      (parameter) => !isBotResourceParameter(parameter),
    );
    if (matchingNonBotParameter !== undefined) {
      return matchingNonBotParameter;
    }
  }

  return firstMatchingParameter;
}

function mergePayloadFilterNodes(filters: readonly PayloadFilterNode[]): PayloadFilterNode | null {
  if (filters.length === 0) {
    return null;
  }

  return filters.length === 1
    ? (filters[0] ?? null)
    : {
        op: "and",
        filters: [...filters],
      };
}

function flattenAndPayloadFilterNodes(filters: readonly PayloadFilterNode[]): PayloadFilterNode[] {
  return filters.flatMap((filter) =>
    filter.op === "and" ? flattenAndPayloadFilterNodes(filter.filters) : [filter],
  );
}

function mergeMultiValueResourceRule(input: {
  conditionRules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>;
  parameterId: string;
  operator: "is" | "is_not";
  values: readonly string[];
}): {
  rules: NonNullable<WebhookTriggerEventParameterRuleMap[string]>;
  merged: boolean;
} {
  const existingRule = input.conditionRules[input.parameterId];
  if (existingRule !== undefined && existingRule.operator !== input.operator) {
    return {
      rules: input.conditionRules,
      merged: false,
    };
  }

  const existingValues = resolveConfiguredRuleValues({
    value: existingRule?.value,
    values: existingRule?.values,
  });

  return {
    rules: {
      ...input.conditionRules,
      [input.parameterId]: {
        operator: input.operator,
        value: "",
        values: [...new Set([...existingValues, ...input.values])],
      },
    },
    merged: true,
  };
}

function buildPayloadFilterNodeForTrigger(input: {
  eventOption: WebhookTriggerEventOption | undefined;
  triggerId: string;
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
}): PayloadFilterNode | null {
  const filters: PayloadFilterNode[] = [];

  if (input.eventOption === undefined) {
    return null;
  }

  const rules = input.eventParameterRules[input.triggerId] ?? {};
  const groupedParameterIds = resolveOneOfGroupParameterIds(input.eventOption);
  const activeGroupedParameterIds = resolveActiveOneOfGroupParameterIds({
    eventOption: input.eventOption,
    rules,
  });

  for (const parameter of input.eventOption.parameters ?? []) {
    if (groupedParameterIds.has(parameter.id) && !activeGroupedParameterIds.has(parameter.id)) {
      continue;
    }

    const rule = rules[parameter.id];
    const configuredValue = rule?.value.trim() ?? "";
    const configuredValues = resolveConfiguredRuleValues({
      value: rule?.value,
      values: rule?.values,
    });
    if (parameter.kind === "resource-select" && parameter.multiValue === true) {
      if (configuredValues.length === 0) {
        continue;
      }

      if (rule?.operator === WebhookTriggerEventParameterRuleOperators.IS_NOT) {
        if (parameter.negatedMatchRequiresExists === true) {
          filters.push(
            buildExistsNode({
              path: [...parameter.payloadPath],
              operator: WebhookTriggerEventParameterRuleOperators.EXISTS,
            }),
          );
        }

        filters.push(
          ...configuredValues.map((value) =>
            buildEqualityNode({
              operator: WebhookTriggerEventParameterRuleOperators.IS_NOT,
              path: [...parameter.payloadPath],
              value,
            }),
          ),
        );
        continue;
      }

      filters.push(
        buildInNode({
          path: [...parameter.payloadPath],
          values: [...configuredValues],
        }),
      );
      continue;
    }

    if (configuredValue.length === 0) {
      continue;
    }

    if (parameter.kind === "enum-select" && parameter.matchMode === "exists") {
      if (
        rule?.operator !== WebhookTriggerEventParameterRuleOperators.EXISTS &&
        rule?.operator !== WebhookTriggerEventParameterRuleOperators.NOT_EXISTS
      ) {
        continue;
      }

      filters.push(
        buildExistsNode({
          path: [...parameter.payloadPath],
          operator: rule.operator,
        }),
      );
      continue;
    }

    if (parameter.kind === "string" && parameter.matchMode === "contains") {
      if (rule?.operator !== WebhookTriggerEventParameterRuleOperators.CONTAINS) {
        continue;
      }

      filters.push(
        buildContainsNode({
          path: [...parameter.payloadPath],
          value: configuredValue,
        }),
      );
      continue;
    }

    if (parameter.kind === "string" && parameter.matchMode === "contains_token") {
      if (rule?.operator !== WebhookTriggerEventParameterRuleOperators.CONTAINS_TOKEN) {
        continue;
      }

      filters.push(
        buildContainsTokenNode({
          path: [...parameter.payloadPath],
          value: configuredValue,
        }),
      );
      continue;
    }

    if (
      rule?.operator !== WebhookTriggerEventParameterRuleOperators.IS &&
      rule?.operator !== WebhookTriggerEventParameterRuleOperators.IS_NOT
    ) {
      continue;
    }

    if (
      parameter.negatedMatchRequiresExists === true &&
      rule.operator === WebhookTriggerEventParameterRuleOperators.IS_NOT
    ) {
      filters.push(
        buildExistsNode({
          path: [...parameter.payloadPath],
          operator: WebhookTriggerEventParameterRuleOperators.EXISTS,
        }),
      );
    }

    filters.push(
      buildEqualityNode({
        operator: rule.operator,
        path: [...parameter.payloadPath],
        value: configuredValue,
      }),
    );
  }

  return mergePayloadFilterNodes(filters);
}

function buildPayloadFiltersByConditionId(input: {
  eventOptions: readonly WebhookTriggerEventOption[];
  selectedEventIds: readonly string[];
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
}): Record<string, PayloadFilterNode> {
  const filtersByConditionId: Record<string, PayloadFilterNode> = {};

  for (const triggerId of input.selectedEventIds) {
    const eventOption = findEventOptionByTriggerId({
      eventOptions: input.eventOptions,
      triggerId,
    });
    const triggerFilter = buildPayloadFilterNodeForTrigger({
      eventOption,
      triggerId,
      eventParameterRules: input.eventParameterRules,
    });
    if (eventOption === undefined || triggerFilter === null) {
      continue;
    }

    filtersByConditionId[triggerId] = triggerFilter;
  }

  return filtersByConditionId;
}

export function mergeWebhookTriggerPayloadFilter(input: {
  eventOptions: readonly WebhookTriggerEventOption[];
  selectedEventIds: readonly string[];
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
  advancedPayloadFilter: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  const eventParameterFiltersByConditionId = buildPayloadFiltersByConditionId({
    eventOptions: input.eventOptions,
    selectedEventIds: input.selectedEventIds,
    eventParameterRules: input.eventParameterRules,
  });
  const mergedPayloadFilter: Record<string, unknown> = {};
  const conditionIds = new Set([
    ...Object.keys(eventParameterFiltersByConditionId),
    ...Object.keys(input.advancedPayloadFilter ?? {}).filter((conditionId) =>
      input.selectedEventIds.includes(conditionId),
    ),
  ]);

  for (const conditionId of conditionIds) {
    const eventParameterFilter = eventParameterFiltersByConditionId[conditionId];
    const advancedPayloadFilterForEvent = input.advancedPayloadFilter?.[conditionId];

    if (eventParameterFilter === undefined) {
      if (advancedPayloadFilterForEvent !== undefined) {
        mergedPayloadFilter[conditionId] = advancedPayloadFilterForEvent;
      }
      continue;
    }

    if (advancedPayloadFilterForEvent === undefined) {
      mergedPayloadFilter[conditionId] = eventParameterFilter;
      continue;
    }

    mergedPayloadFilter[conditionId] = {
      op: "and",
      filters: [eventParameterFilter, advancedPayloadFilterForEvent],
    };
  }

  return Object.keys(mergedPayloadFilter).length === 0 ? null : mergedPayloadFilter;
}

export function extractWebhookTriggerEventParameterRules(input: {
  eventOptions: readonly WebhookTriggerEventOption[];
  selectedEventIds: readonly string[];
  payloadFilter: Record<string, unknown> | null;
}): {
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
  remainingPayloadFilter: Record<string, unknown> | null;
} {
  if (input.payloadFilter === null) {
    return {
      eventParameterRules: {},
      remainingPayloadFilter: null,
    };
  }

  const eventParameterRules: WebhookTriggerEventParameterRuleMap = {};
  const remainingPayloadFilter: Record<string, unknown> = {};

  for (const [conditionId, eventPayloadFilter] of Object.entries(input.payloadFilter)) {
    if (!input.selectedEventIds.includes(conditionId)) {
      remainingPayloadFilter[conditionId] = eventPayloadFilter;
      continue;
    }

    const eventOption = findEventOptionByTriggerId({
      eventOptions: input.eventOptions,
      triggerId: conditionId,
    });
    if (eventOption === undefined) {
      remainingPayloadFilter[conditionId] = eventPayloadFilter;
      continue;
    }

    const parsedPayloadFilter = parseKnownPayloadFilterNode(eventPayloadFilter);
    if (parsedPayloadFilter === null) {
      remainingPayloadFilter[conditionId] = eventPayloadFilter;
      continue;
    }

    const rootFilters =
      parsedPayloadFilter.op === "and"
        ? flattenAndPayloadFilterNodes(parsedPayloadFilter.filters)
        : [parsedPayloadFilter];
    const remainingFilters: PayloadFilterNode[] = [];

    for (const filter of rootFilters) {
      if (
        filter.op !== "eq" &&
        filter.op !== "neq" &&
        filter.op !== "contains" &&
        filter.op !== "contains_token" &&
        filter.op !== "in" &&
        filter.op !== "exists" &&
        filter.op !== "not_exists"
      ) {
        remainingFilters.push(filter);
        continue;
      }

      let extracted = false;

      const parameter = resolvePayloadFilterParameter({
        parameters: eventOption.parameters ?? [],
        filter,
      });
      if (parameter === undefined) {
        remainingFilters.push(filter);
        continue;
      }

      if (
        parameter.negatedMatchRequiresExists === true &&
        filter.op === WebhookTriggerEventParameterRuleOperators.EXISTS &&
        hasNegatedFilterForPath({
          filters: rootFilters,
          path: parameter.payloadPath,
        })
      ) {
        continue;
      }

      if (parameter.kind === "enum-select" && parameter.matchMode === "exists") {
        if (filter.op === "exists" || filter.op === "not_exists") {
          eventParameterRules[conditionId] = {
            ...(eventParameterRules[conditionId] ?? {}),
            [parameter.id]: {
              operator: filter.op,
              value: filter.op,
            },
          };
          extracted = true;
        }
      } else if (
        parameter.kind === "string" &&
        (parameter.matchMode === "contains" || parameter.matchMode === "contains_token")
      ) {
        if (filter.op === parameter.matchMode) {
          eventParameterRules[conditionId] = {
            ...(eventParameterRules[conditionId] ?? {}),
            [parameter.id]: {
              operator: filter.op,
              value: filter.value,
            },
          };
          extracted = true;
        }
      } else if (parameter.kind === "resource-select" && parameter.multiValue === true) {
        if (filter.op === "in" || filter.op === "eq" || filter.op === "neq") {
          const operator =
            filter.op === "neq"
              ? WebhookTriggerEventParameterRuleOperators.IS_NOT
              : WebhookTriggerEventParameterRuleOperators.IS;
          const mergeResult = mergeMultiValueResourceRule({
            conditionRules: eventParameterRules[conditionId] ?? {},
            parameterId: parameter.id,
            operator,
            values: filter.op === "in" ? filter.values : [filter.value],
          });
          eventParameterRules[conditionId] = mergeResult.rules;
          extracted = mergeResult.merged;
        }
      } else if (filter.op === "eq" || filter.op === "neq") {
        eventParameterRules[conditionId] = {
          ...(eventParameterRules[conditionId] ?? {}),
          [parameter.id]: {
            operator:
              filter.op === "neq"
                ? WebhookTriggerEventParameterRuleOperators.IS_NOT
                : WebhookTriggerEventParameterRuleOperators.IS,
            value: filter.value,
          },
        };
        extracted = true;
      }

      if (!extracted) {
        remainingFilters.push(filter);
      }
    }

    const remainingEventFilter = mergePayloadFilterNodes(remainingFilters);
    if (remainingEventFilter !== null) {
      remainingPayloadFilter[conditionId] = remainingEventFilter;
    }
  }

  return {
    eventParameterRules,
    remainingPayloadFilter:
      Object.keys(remainingPayloadFilter).length === 0 ? null : remainingPayloadFilter,
  };
}
