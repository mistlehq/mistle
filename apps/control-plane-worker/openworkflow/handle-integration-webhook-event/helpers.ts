import { path } from "./path.js";
import type {
  WebhookPayloadFilter,
  WebhookPayloadFilterPath,
  WebhookPayloadFilterScalar,
} from "./types.js";

type AndWebhookPayloadFilter = Extract<WebhookPayloadFilter, { op: "and" }>;
type OrWebhookPayloadFilter = Extract<WebhookPayloadFilter, { op: "or" }>;
type NotWebhookPayloadFilter = Extract<WebhookPayloadFilter, { op: "not" }>;
type EqWebhookPayloadFilter = Extract<WebhookPayloadFilter, { op: "eq" }>;
type NeqWebhookPayloadFilter = Extract<WebhookPayloadFilter, { op: "neq" }>;
type InWebhookPayloadFilter = Extract<WebhookPayloadFilter, { op: "in" }>;
type ContainsWebhookPayloadFilter = Extract<WebhookPayloadFilter, { op: "contains" }>;
type ContainsTokenWebhookPayloadFilter = Extract<WebhookPayloadFilter, { op: "contains_token" }>;
type StartsWithWebhookPayloadFilter = Extract<WebhookPayloadFilter, { op: "starts_with" }>;
type EndsWithWebhookPayloadFilter = Extract<WebhookPayloadFilter, { op: "ends_with" }>;
type ExistsWebhookPayloadFilter = Extract<WebhookPayloadFilter, { op: "exists" }>;
type NotExistsWebhookPayloadFilter = Extract<WebhookPayloadFilter, { op: "not_exists" }>;

function cloneFiltersOrThrow(
  input: ReadonlyArray<WebhookPayloadFilter>,
): ReadonlyArray<WebhookPayloadFilter> {
  if (input.length === 0) {
    throw new Error("Webhook payload filter composition requires at least one filter.");
  }

  return [...input];
}

function cloneScalarsOrThrow(
  input: ReadonlyArray<WebhookPayloadFilterScalar>,
): ReadonlyArray<WebhookPayloadFilterScalar> {
  if (input.length === 0) {
    throw new Error("Webhook payload filter in-list requires at least one value.");
  }

  return [...input];
}

export function and(filters: ReadonlyArray<WebhookPayloadFilter>): AndWebhookPayloadFilter {
  return {
    op: "and",
    filters: cloneFiltersOrThrow(filters),
  };
}

export function or(filters: ReadonlyArray<WebhookPayloadFilter>): OrWebhookPayloadFilter {
  return {
    op: "or",
    filters: cloneFiltersOrThrow(filters),
  };
}

export function not(filter: WebhookPayloadFilter): NotWebhookPayloadFilter {
  return {
    op: "not",
    filter,
  };
}

export function eq(
  filterPath: WebhookPayloadFilterPath,
  value: WebhookPayloadFilterScalar,
): EqWebhookPayloadFilter {
  return {
    op: "eq",
    path: path(filterPath),
    value,
  };
}

export function neq(
  filterPath: WebhookPayloadFilterPath,
  value: WebhookPayloadFilterScalar,
): NeqWebhookPayloadFilter {
  return {
    op: "neq",
    path: path(filterPath),
    value,
  };
}

export function inList(
  filterPath: WebhookPayloadFilterPath,
  values: ReadonlyArray<WebhookPayloadFilterScalar>,
): InWebhookPayloadFilter {
  return {
    op: "in",
    path: path(filterPath),
    values: cloneScalarsOrThrow(values),
  };
}

export function contains(
  filterPath: WebhookPayloadFilterPath,
  value: string,
): ContainsWebhookPayloadFilter {
  return {
    op: "contains",
    path: path(filterPath),
    value,
  };
}

export function containsToken(
  filterPath: WebhookPayloadFilterPath,
  value: string,
): ContainsTokenWebhookPayloadFilter {
  return {
    op: "contains_token",
    path: path(filterPath),
    value,
  };
}

export function startsWith(
  filterPath: WebhookPayloadFilterPath,
  value: string,
): StartsWithWebhookPayloadFilter {
  return {
    op: "starts_with",
    path: path(filterPath),
    value,
  };
}

export function endsWith(
  filterPath: WebhookPayloadFilterPath,
  value: string,
): EndsWithWebhookPayloadFilter {
  return {
    op: "ends_with",
    path: path(filterPath),
    value,
  };
}

export function exists(filterPath: WebhookPayloadFilterPath): ExistsWebhookPayloadFilter {
  return {
    op: "exists",
    path: path(filterPath),
  };
}

export function notExists(filterPath: WebhookPayloadFilterPath): NotExistsWebhookPayloadFilter {
  return {
    op: "not_exists",
    path: path(filterPath),
  };
}
