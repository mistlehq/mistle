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

function isTokenBoundaryCharacter(value: string): boolean {
  return !/[\p{L}\p{N}\p{M}_]/u.test(value);
}

function getCodePointBefore(input: { value: string; index: number }): string | null {
  if (input.index <= 0) {
    return null;
  }

  const precedingCodeUnit = input.value.charCodeAt(input.index - 1);
  if (precedingCodeUnit >= 0xdc00 && precedingCodeUnit <= 0xdfff && input.index >= 2) {
    const leadingCodeUnit = input.value.charCodeAt(input.index - 2);
    if (leadingCodeUnit >= 0xd800 && leadingCodeUnit <= 0xdbff) {
      return input.value.slice(input.index - 2, input.index);
    }
  }

  return input.value.slice(input.index - 1, input.index);
}

function getCodePointAfter(input: { value: string; index: number }): string | null {
  if (input.index >= input.value.length) {
    return null;
  }

  const trailingCodeUnit = input.value.charCodeAt(input.index);
  if (
    trailingCodeUnit >= 0xd800 &&
    trailingCodeUnit <= 0xdbff &&
    input.index + 1 < input.value.length
  ) {
    const followingCodeUnit = input.value.charCodeAt(input.index + 1);
    if (followingCodeUnit >= 0xdc00 && followingCodeUnit <= 0xdfff) {
      return input.value.slice(input.index, input.index + 2);
    }
  }

  return input.value.slice(input.index, input.index + 1);
}

function containsToken(input: { value: string; token: string }): boolean {
  if (input.token.length === 0) {
    return false;
  }

  let searchStartIndex = 0;

  while (true) {
    const matchedIndex = input.value.indexOf(input.token, searchStartIndex);
    if (matchedIndex === -1) {
      return false;
    }

    const precedingCharacter = getCodePointBefore({
      value: input.value,
      index: matchedIndex,
    });
    const followingCharacter = getCodePointAfter({
      value: input.value,
      index: matchedIndex + input.token.length,
    });
    const hasLeadingBoundary =
      precedingCharacter === null || isTokenBoundaryCharacter(precedingCharacter);
    const hasTrailingBoundary =
      followingCharacter === null || isTokenBoundaryCharacter(followingCharacter);

    if (hasLeadingBoundary && hasTrailingBoundary) {
      return true;
    }

    searchStartIndex = matchedIndex + 1;
  }
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
