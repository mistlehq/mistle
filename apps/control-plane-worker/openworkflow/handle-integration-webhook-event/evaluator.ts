import {
  containsToken,
  evaluateFilterNode,
  getValueAtPath,
  type SharedFilter,
} from "@mistle/integrations-core/triggers";

import type {
  WebhookPayloadFilter,
  WebhookPayloadFilterPath,
  WebhookPayloadFilterScalar,
} from "./types.js";

function isWebhookPayloadFilterScalar(value: unknown): value is WebhookPayloadFilterScalar {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

function normalizeWebhookFilter(filter: WebhookPayloadFilter): SharedFilter | null {
  if (filter.op === "and" || filter.op === "or") {
    const normalizedFilters: SharedFilter[] = [];

    for (const nestedFilter of filter.filters) {
      const normalizedNestedFilter = normalizeWebhookFilter(nestedFilter);
      if (normalizedNestedFilter === null) {
        return null;
      }

      normalizedFilters.push(normalizedNestedFilter);
    }

    return {
      op: filter.op === "and" ? "all" : "any",
      filters: normalizedFilters,
    };
  }

  if (filter.op === "not") {
    const normalizedNestedFilter = normalizeWebhookFilter(filter.filter);
    if (normalizedNestedFilter === null) {
      return null;
    }

    return {
      op: "not",
      filter: normalizedNestedFilter,
    };
  }

  if (filter.op === "exists") {
    return {
      op: "exists",
      path: filter.path,
    };
  }

  if (filter.op === "eq") {
    if (filter.value === null) {
      return null;
    }

    return {
      op: "eq",
      path: filter.path,
      value: filter.value,
    };
  }

  if (filter.op === "in") {
    const normalizedValues: Array<string | number | boolean> = [];

    for (const value of filter.values) {
      if (value === null) {
        return null;
      }

      normalizedValues.push(value);
    }

    return {
      op: "in",
      path: filter.path,
      values: normalizedValues,
    };
  }

  if (filter.op === "contains") {
    return {
      op: "contains",
      path: filter.path,
      value: filter.value,
    };
  }

  if (filter.op === "contains_token") {
    return {
      op: "containsToken",
      path: filter.path,
      value: filter.value,
    };
  }

  if (filter.op === "starts_with") {
    return {
      op: "startsWith",
      path: filter.path,
      value: filter.value,
    };
  }

  return null;
}

export function getWebhookPayloadValueAtPath(input: {
  payload: unknown;
  path: WebhookPayloadFilterPath;
}): unknown {
  return getValueAtPath({
    payload: input.payload,
    path: input.path,
    options: {
      allowArrayTraversal: true,
      propertyAccess: "own",
    },
  });
}

export function evaluateWebhookPayloadFilter(input: {
  filter: WebhookPayloadFilter;
  payload: unknown;
}): boolean {
  const { filter, payload } = input;
  const normalizedFilter = normalizeWebhookFilter(filter);

  if (normalizedFilter !== null) {
    return evaluateFilterNode({
      filter: normalizedFilter,
      resolveValueAtPath(path) {
        return getWebhookPayloadValueAtPath({
          payload,
          path,
        });
      },
    });
  }

  if (filter.op === "and") {
    return filter.filters.every((nestedFilter) =>
      evaluateWebhookPayloadFilter({
        filter: nestedFilter,
        payload,
      }),
    );
  }

  if (filter.op === "or") {
    return filter.filters.some((nestedFilter) =>
      evaluateWebhookPayloadFilter({
        filter: nestedFilter,
        payload,
      }),
    );
  }

  if (filter.op === "not") {
    return !evaluateWebhookPayloadFilter({
      filter: filter.filter,
      payload,
    });
  }

  const resolvedValue = getWebhookPayloadValueAtPath({
    payload,
    path: filter.path,
  });

  if (filter.op === "exists") {
    return resolvedValue !== undefined;
  }

  if (filter.op === "not_exists") {
    return resolvedValue === undefined;
  }

  if (filter.op === "eq") {
    return resolvedValue === filter.value;
  }

  if (filter.op === "neq") {
    return resolvedValue !== filter.value;
  }

  if (filter.op === "in") {
    if (!isWebhookPayloadFilterScalar(resolvedValue)) {
      return false;
    }

    return filter.values.includes(resolvedValue);
  }

  if (filter.op === "contains") {
    if (typeof resolvedValue !== "string") {
      return false;
    }

    return resolvedValue.includes(filter.value);
  }

  if (filter.op === "contains_token") {
    if (typeof resolvedValue !== "string") {
      return false;
    }

    return containsToken({
      value: resolvedValue,
      token: filter.value,
    });
  }

  if (filter.op === "starts_with") {
    if (typeof resolvedValue !== "string") {
      return false;
    }

    return resolvedValue.startsWith(filter.value);
  }

  if (filter.op === "ends_with") {
    if (typeof resolvedValue !== "string") {
      return false;
    }

    return resolvedValue.endsWith(filter.value);
  }

  return false;
}
