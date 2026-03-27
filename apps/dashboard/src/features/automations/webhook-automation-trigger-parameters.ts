import type {
  WebhookAutomationEventOption,
  WebhookAutomationTriggerParameterValueMap,
} from "./webhook-automation-trigger-types.js";

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

function buildPayloadFilterNodeFromTriggerParameters(input: {
  eventOptions: readonly WebhookAutomationEventOption[];
  selectedTriggerIds: readonly string[];
  triggerParameterValues: WebhookAutomationTriggerParameterValueMap;
}): PayloadFilterNode | null {
  const filters: PayloadFilterNode[] = [];

  for (const triggerId of input.selectedTriggerIds) {
    const eventOption = input.eventOptions.find((option) => option.id === triggerId);
    if (eventOption === undefined) {
      continue;
    }

    for (const parameter of eventOption.parameters ?? []) {
      const configuredValue = input.triggerParameterValues[triggerId]?.[parameter.id]?.trim() ?? "";
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
  }

  if (filters.length === 0) {
    return null;
  }

  return filters.length === 1
    ? (filters[0] ?? null)
    : {
        op: "and",
        filters,
      };
}

export function mergeWebhookAutomationPayloadFilter(input: {
  eventOptions: readonly WebhookAutomationEventOption[];
  selectedTriggerIds: readonly string[];
  triggerParameterValues: WebhookAutomationTriggerParameterValueMap;
  advancedPayloadFilter: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  const triggerParameterFilter = buildPayloadFilterNodeFromTriggerParameters({
    eventOptions: input.eventOptions,
    selectedTriggerIds: input.selectedTriggerIds,
    triggerParameterValues: input.triggerParameterValues,
  });

  if (triggerParameterFilter === null) {
    return input.advancedPayloadFilter;
  }

  if (input.advancedPayloadFilter === null) {
    return triggerParameterFilter;
  }

  return {
    op: "and",
    filters: [triggerParameterFilter, input.advancedPayloadFilter],
  };
}

export function extractWebhookAutomationTriggerParameterValues(input: {
  eventOptions: readonly WebhookAutomationEventOption[];
  selectedTriggerIds: readonly string[];
  payloadFilter: Record<string, unknown> | null;
}): {
  triggerParameterValues: WebhookAutomationTriggerParameterValueMap;
  remainingPayloadFilter: Record<string, unknown> | null;
} {
  if (input.payloadFilter === null) {
    return {
      triggerParameterValues: {},
      remainingPayloadFilter: null,
    };
  }

  const parsedPayloadFilter = parseKnownPayloadFilterNode(input.payloadFilter);
  if (parsedPayloadFilter === null) {
    return {
      triggerParameterValues: {},
      remainingPayloadFilter: input.payloadFilter,
    };
  }

  const rootFilters =
    parsedPayloadFilter.op === "and" ? parsedPayloadFilter.filters : [parsedPayloadFilter];
  const triggerParameterValues: WebhookAutomationTriggerParameterValueMap = {};
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

    for (const triggerId of input.selectedTriggerIds) {
      const eventOption = input.eventOptions.find((option) => option.id === triggerId);
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
              triggerParameterValues[triggerId] = {
                ...(triggerParameterValues[triggerId] ?? {}),
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
              triggerParameterValues[triggerId] = {
                ...(triggerParameterValues[triggerId] ?? {}),
                [parameter.id]: filter.value,
              };
              extracted = true;
            }
            break;
          }

          if (filter.op !== "eq") {
            break;
          }

          triggerParameterValues[triggerId] = {
            ...(triggerParameterValues[triggerId] ?? {}),
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

  if (remainingFilters.length === 0) {
    return {
      triggerParameterValues,
      remainingPayloadFilter: null,
    };
  }

  if (remainingFilters.length === 1) {
    return {
      triggerParameterValues,
      remainingPayloadFilter: remainingFilters[0] ?? null,
    };
  }

  return {
    triggerParameterValues,
    remainingPayloadFilter: {
      op: "and",
      filters: remainingFilters,
    },
  };
}

export function applyWebhookAutomationTriggerParameterDefaults(input: {
  eventOptions: readonly WebhookAutomationEventOption[];
  selectedTriggerIds: readonly string[];
  triggerParameterValues: WebhookAutomationTriggerParameterValueMap;
}): WebhookAutomationTriggerParameterValueMap {
  const nextValues: WebhookAutomationTriggerParameterValueMap = {};

  for (const triggerId of input.selectedTriggerIds) {
    const existingValues = input.triggerParameterValues[triggerId] ?? {};
    const nextTriggerValues: Record<string, string> = { ...existingValues };
    const eventOption = input.eventOptions.find((option) => option.id === triggerId);

    for (const parameter of eventOption?.parameters ?? []) {
      if (parameter.kind !== "string" || parameter.defaultEnabled !== true) {
        continue;
      }

      const configuredValue = nextTriggerValues[parameter.id]?.trim() ?? "";
      if (configuredValue.length > 0) {
        continue;
      }

      const defaultValue = parameter.defaultValue?.trim() ?? "";
      if (defaultValue.length === 0) {
        continue;
      }

      nextTriggerValues[parameter.id] = defaultValue;
    }

    nextValues[triggerId] = nextTriggerValues;
  }

  return nextValues;
}
