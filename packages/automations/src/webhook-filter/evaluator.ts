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

function readOwnPropertyValue(target: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor === undefined) {
    return undefined;
  }

  if ("value" in descriptor) {
    return descriptor.value;
  }

  return descriptor.get?.call(target);
}

export function getWebhookPayloadValueAtPath(input: {
  payload: unknown;
  path: WebhookPayloadFilterPath;
}): unknown {
  let cursor: unknown = input.payload;

  for (const segment of input.path) {
    if (Array.isArray(cursor)) {
      const segmentAsInteger = Number(segment);
      if (!Number.isInteger(segmentAsInteger) || segmentAsInteger < 0) {
        return undefined;
      }

      cursor = cursor[segmentAsInteger];
      continue;
    }

    if (typeof cursor !== "object" || cursor === null) {
      return undefined;
    }

    if (!Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return undefined;
    }

    cursor = readOwnPropertyValue(cursor, segment);
  }

  return cursor;
}

export function evaluateWebhookPayloadFilter(input: {
  filter: WebhookPayloadFilter;
  payload: unknown;
}): boolean {
  const { filter, payload } = input;

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
