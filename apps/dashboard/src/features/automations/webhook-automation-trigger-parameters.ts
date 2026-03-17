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
      op: "eq";
      path: string[];
      value: string;
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

  return null;
}

function buildEqNode(input: { path: string[]; value: string }): PayloadFilterNode {
  return {
    op: "eq",
    path: input.path,
    value: input.value,
  };
}

function buildPayloadFilterNodeFromTriggerParameters(input: {
  eventOptions: readonly WebhookAutomationEventOption[];
  selectedEventTypes: readonly string[];
  triggerParameterValues: WebhookAutomationTriggerParameterValueMap;
}): PayloadFilterNode | null {
  const filters: PayloadFilterNode[] = [];

  for (const eventType of input.selectedEventTypes) {
    const eventOption = input.eventOptions.find((option) => option.value === eventType);
    if (eventOption === undefined) {
      continue;
    }

    for (const parameter of eventOption.parameters ?? []) {
      const configuredValue = input.triggerParameterValues[eventType]?.[parameter.id]?.trim() ?? "";
      if (configuredValue.length === 0) {
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
  selectedEventTypes: readonly string[];
  triggerParameterValues: WebhookAutomationTriggerParameterValueMap;
  advancedPayloadFilter: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  const triggerParameterFilter = buildPayloadFilterNodeFromTriggerParameters({
    eventOptions: input.eventOptions,
    selectedEventTypes: input.selectedEventTypes,
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
  selectedEventTypes: readonly string[];
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
    if (filter.op !== "eq") {
      remainingFilters.push(filter);
      continue;
    }

    let extracted = false;

    for (const eventType of input.selectedEventTypes) {
      const eventOption = input.eventOptions.find((option) => option.value === eventType);
      if (eventOption === undefined) {
        continue;
      }

      for (const parameter of eventOption.parameters ?? []) {
        if (
          parameter.payloadPath.length === filter.path.length &&
          parameter.payloadPath.every((segment, index) => segment === filter.path[index])
        ) {
          triggerParameterValues[eventType] = {
            ...(triggerParameterValues[eventType] ?? {}),
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
