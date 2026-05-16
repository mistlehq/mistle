import type {
  WebhookTriggerEventOption,
  WebhookTriggerEventParameterValueMap,
} from "./webhook-trigger-event-types.js";

type PayloadFilterNode =
  | {
      op: "and";
      filters: PayloadFilterNode[];
    }
  | {
      op: "eq" | "contains" | "contains_token";
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

  if (value["op"] === "eq") {
    if (!isStringArray(value["path"]) || typeof value["value"] !== "string") {
      return null;
    }

    return {
      op: "eq",
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

function buildEqNode(input: { path: string[]; value: string }): PayloadFilterNode {
  return {
    op: "eq",
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

function buildPayloadFilterNodeForTrigger(input: {
  eventOption: WebhookTriggerEventOption | undefined;
  triggerId: string;
  eventParameterValues: WebhookTriggerEventParameterValueMap;
}): PayloadFilterNode | null {
  const filters: PayloadFilterNode[] = [];

  if (input.eventOption === undefined) {
    return null;
  }

  for (const parameter of input.eventOption.parameters ?? []) {
    const configuredValue =
      input.eventParameterValues[input.triggerId]?.[parameter.id]?.trim() ?? "";
    if (configuredValue.length === 0) {
      continue;
    }

    if (parameter.kind === "enum-select" && parameter.matchMode === "exists") {
      if (configuredValue !== "exists" && configuredValue !== "not_exists") {
        continue;
      }

      filters.push(
        buildExistsNode({
          path: [...parameter.payloadPath],
          operator: configuredValue,
        }),
      );
      continue;
    }

    if (parameter.kind === "string" && parameter.matchMode === "contains") {
      filters.push(
        buildContainsNode({
          path: [...parameter.payloadPath],
          value: configuredValue,
        }),
      );
      continue;
    }

    if (parameter.kind === "string" && parameter.matchMode === "contains_token") {
      filters.push(
        buildContainsTokenNode({
          path: [...parameter.payloadPath],
          value: configuredValue,
        }),
      );
      continue;
    }

    filters.push(
      buildEqNode({
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
  eventParameterValues: WebhookTriggerEventParameterValueMap;
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
      eventParameterValues: input.eventParameterValues,
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
  eventParameterValues: WebhookTriggerEventParameterValueMap;
  advancedPayloadFilter: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  const eventParameterFiltersByEventType = buildPayloadFiltersByEventType({
    eventOptions: input.eventOptions,
    selectedEventIds: input.selectedEventIds,
    eventParameterValues: input.eventParameterValues,
  });
  const mergedPayloadFilter: Record<string, unknown> = {};
  const eventTypes = new Set([
    ...Object.keys(eventParameterFiltersByEventType),
    ...Object.keys(input.advancedPayloadFilter ?? {}),
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

export function extractWebhookTriggerEventParameterValues(input: {
  eventOptions: readonly WebhookTriggerEventOption[];
  selectedEventIds: readonly string[];
  payloadFilter: Record<string, unknown> | null;
}): {
  eventParameterValues: WebhookTriggerEventParameterValueMap;
  remainingPayloadFilter: Record<string, unknown> | null;
} {
  if (input.payloadFilter === null) {
    return {
      eventParameterValues: {},
      remainingPayloadFilter: null,
    };
  }

  const eventParameterValues: WebhookTriggerEventParameterValueMap = {};
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
      parsedPayloadFilter.op === "and" ? parsedPayloadFilter.filters : [parsedPayloadFilter];
    const remainingFilters: PayloadFilterNode[] = [];

    for (const filter of rootFilters) {
      if (
        filter.op !== "eq" &&
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
            if (parameter.kind === "enum-select" && parameter.matchMode === "exists") {
              if (filter.op === "exists" || filter.op === "not_exists") {
                eventParameterValues[triggerId] = {
                  ...(eventParameterValues[triggerId] ?? {}),
                  [parameter.id]: filter.op,
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
                eventParameterValues[triggerId] = {
                  ...(eventParameterValues[triggerId] ?? {}),
                  [parameter.id]: filter.value,
                };
                extracted = true;
              }
              break;
            }

            if (filter.op !== "eq") {
              break;
            }

            eventParameterValues[triggerId] = {
              ...(eventParameterValues[triggerId] ?? {}),
              [parameter.id]: filter.value,
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
    eventParameterValues,
    remainingPayloadFilter:
      Object.keys(remainingPayloadFilter).length === 0 ? null : remainingPayloadFilter,
  };
}
