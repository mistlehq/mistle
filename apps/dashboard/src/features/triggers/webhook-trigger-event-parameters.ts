import type {
  WebhookTriggerEventOption,
  WebhookTriggerEventParameterRuleMap,
} from "./webhook-trigger-event-types.js";
import { WebhookTriggerEventParameterRuleOperators } from "./webhook-trigger-event-types.js";

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
      op: "exists" | "not_exists";
      path: string[];
    };

function findEventOptionByTriggerId(input: {
  eventOptions: readonly WebhookTriggerEventOption[];
  triggerId: string;
}): WebhookTriggerEventOption | undefined {
  return input.eventOptions.find((option) => option.id === input.triggerId);
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
  rules: Record<string, { value: string } | undefined>;
}): Set<string> {
  const activeParameterIds = new Set<string>();

  for (const group of input.eventOption.parameterGroups ?? []) {
    const configuredParameterIds = group.options
      .filter((option) => (input.rules[option.parameterId]?.value.trim().length ?? 0) > 0)
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

function buildPayloadFiltersByEventType(input: {
  eventOptions: readonly WebhookTriggerEventOption[];
  selectedEventIds: readonly string[];
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
}): Record<string, PayloadFilterNode> {
  const filtersByEventType = new Map<string, PayloadFilterNode[]>();

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

    const eventFilters = filtersByEventType.get(eventOption.eventType);
    if (eventFilters === undefined) {
      filtersByEventType.set(eventOption.eventType, [triggerFilter]);
      continue;
    }

    eventFilters.push(triggerFilter);
  }

  const mergedFiltersByEventType: Record<string, PayloadFilterNode> = {};
  for (const [eventType, filters] of filtersByEventType.entries()) {
    const mergedFilter = mergePayloadFilterNodes(filters);
    if (mergedFilter !== null) {
      mergedFiltersByEventType[eventType] = mergedFilter;
    }
  }

  return mergedFiltersByEventType;
}

export function mergeWebhookTriggerPayloadFilter(input: {
  eventOptions: readonly WebhookTriggerEventOption[];
  selectedEventIds: readonly string[];
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
  advancedPayloadFilter: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  const eventParameterFiltersByEventType = buildPayloadFiltersByEventType({
    eventOptions: input.eventOptions,
    selectedEventIds: input.selectedEventIds,
    eventParameterRules: input.eventParameterRules,
  });
  const selectedEventTypes = new Set(
    input.selectedEventIds
      .map((triggerId) =>
        findEventOptionByTriggerId({
          eventOptions: input.eventOptions,
          triggerId,
        }),
      )
      .map((eventOption) => eventOption?.eventType)
      .filter((eventType): eventType is string => eventType !== undefined),
  );
  const mergedPayloadFilter: Record<string, unknown> = {};
  const eventTypes = new Set([
    ...Object.keys(eventParameterFiltersByEventType),
    ...Object.keys(input.advancedPayloadFilter ?? {}).filter((eventType) =>
      selectedEventTypes.has(eventType),
    ),
  ]);

  for (const eventType of eventTypes) {
    const eventParameterFilter = eventParameterFiltersByEventType[eventType];
    const advancedPayloadFilterForEvent = input.advancedPayloadFilter?.[eventType];

    if (eventParameterFilter === undefined) {
      if (advancedPayloadFilterForEvent !== undefined) {
        mergedPayloadFilter[eventType] = advancedPayloadFilterForEvent;
      }
      continue;
    }

    if (advancedPayloadFilterForEvent === undefined) {
      mergedPayloadFilter[eventType] = eventParameterFilter;
      continue;
    }

    mergedPayloadFilter[eventType] = {
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

  for (const [eventType, eventPayloadFilter] of Object.entries(input.payloadFilter)) {
    const matchingEventIds = input.selectedEventIds.filter((triggerId) => {
      const eventOption = findEventOptionByTriggerId({
        eventOptions: input.eventOptions,
        triggerId,
      });
      return eventOption?.eventType === eventType;
    });

    if (matchingEventIds.length === 0) {
      remainingPayloadFilter[eventType] = eventPayloadFilter;
      continue;
    }

    const parsedPayloadFilter = parseKnownPayloadFilterNode(eventPayloadFilter);
    if (parsedPayloadFilter === null) {
      remainingPayloadFilter[eventType] = eventPayloadFilter;
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
        filter.op !== "exists" &&
        filter.op !== "not_exists"
      ) {
        remainingFilters.push(filter);
        continue;
      }

      let extracted = false;

      for (const triggerId of matchingEventIds) {
        const eventOption = findEventOptionByTriggerId({
          eventOptions: input.eventOptions,
          triggerId,
        });
        if (eventOption === undefined) {
          continue;
        }

        for (const parameter of eventOption.parameters ?? []) {
          if (
            parameter.payloadPath.length === filter.path.length &&
            parameter.payloadPath.every((segment, index) => segment === filter.path[index])
          ) {
            if (
              parameter.negatedMatchRequiresExists === true &&
              filter.op === WebhookTriggerEventParameterRuleOperators.EXISTS &&
              hasNegatedFilterForPath({
                filters: rootFilters,
                path: parameter.payloadPath,
              })
            ) {
              extracted = true;
              break;
            }

            if (parameter.kind === "enum-select" && parameter.matchMode === "exists") {
              if (filter.op === "exists" || filter.op === "not_exists") {
                eventParameterRules[triggerId] = {
                  ...(eventParameterRules[triggerId] ?? {}),
                  [parameter.id]: {
                    operator: filter.op,
                    value: filter.op,
                  },
                };
                extracted = true;
              }
              break;
            }

            if (
              parameter.kind === "string" &&
              (parameter.matchMode === "contains" || parameter.matchMode === "contains_token")
            ) {
              if (filter.op === parameter.matchMode) {
                eventParameterRules[triggerId] = {
                  ...(eventParameterRules[triggerId] ?? {}),
                  [parameter.id]: {
                    operator: filter.op,
                    value: filter.value,
                  },
                };
                extracted = true;
              }
              break;
            }

            if (filter.op !== "eq" && filter.op !== "neq") {
              break;
            }

            eventParameterRules[triggerId] = {
              ...(eventParameterRules[triggerId] ?? {}),
              [parameter.id]: {
                operator:
                  filter.op === "neq"
                    ? WebhookTriggerEventParameterRuleOperators.IS_NOT
                    : WebhookTriggerEventParameterRuleOperators.IS,
                value: filter.value,
              },
            };
            extracted = true;
            break;
          }
        }

        if (extracted) {
          break;
        }
      }

      if (!extracted) {
        remainingFilters.push(filter);
      }
    }

    const remainingEventFilter = mergePayloadFilterNodes(remainingFilters);
    if (remainingEventFilter !== null) {
      remainingPayloadFilter[eventType] = remainingEventFilter;
    }
  }

  return {
    eventParameterRules,
    remainingPayloadFilter:
      Object.keys(remainingPayloadFilter).length === 0 ? null : remainingPayloadFilter,
  };
}
