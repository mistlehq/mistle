import { z } from "zod";

import { IntegrationManifestError, ManifestErrorCodes } from "../errors/index.js";
import type { TriggerFilter, TriggerRule } from "../types/index.js";

type ValidationIssue = {
  path: ReadonlyArray<PropertyKey>;
  message: string;
};

function formatIssues(issues: ReadonlyArray<ValidationIssue>): string {
  return issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");
}

const TriggerScalarValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const TriggerPathCursorSchema = z.record(z.string(), z.unknown());

export const TriggerFilterSchema: z.ZodType<TriggerFilter> = z.lazy(() =>
  z.union([
    z
      .object({
        op: z.literal("all"),
        filters: z.array(TriggerFilterSchema).min(1),
      })
      .strict(),
    z
      .object({
        op: z.literal("any"),
        filters: z.array(TriggerFilterSchema).min(1),
      })
      .strict(),
    z
      .object({
        op: z.literal("not"),
        filter: TriggerFilterSchema,
      })
      .strict(),
    z
      .object({
        op: z.literal("eq"),
        path: z.string().min(1),
        value: TriggerScalarValueSchema,
      })
      .strict(),
    z
      .object({
        op: z.literal("in"),
        path: z.string().min(1),
        values: z.array(z.union([z.string(), z.number()])).min(1),
      })
      .strict(),
    z
      .object({
        op: z.literal("contains"),
        path: z.string().min(1),
        value: z.string(),
      })
      .strict(),
    z
      .object({
        op: z.literal("startsWith"),
        path: z.string().min(1),
        value: z.string(),
      })
      .strict(),
    z
      .object({
        op: z.literal("exists"),
        path: z.string().min(1),
      })
      .strict(),
  ]),
);

export const TriggerActionSchema = z
  .object({
    type: z.literal("deliver-input"),
    inputTemplate: z.string().min(1),
    conversationKeyTemplate: z.string().min(1),
    idempotencyKeyTemplate: z.string().min(1).optional(),
  })
  .strict();

export const TriggerRuleSchema = z
  .object({
    id: z.string().min(1),
    sourceBindingId: z.string().min(1),
    eventType: z
      .string()
      .min(1)
      .regex(/^[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_.-]+$/),
    filter: TriggerFilterSchema,
    action: TriggerActionSchema,
    enabled: z.boolean(),
  })
  .strict();

export const TriggerRulesSchema = z.array(TriggerRuleSchema);

function getValueAtPath(input: { payload: unknown; path: string }): unknown {
  const segments = input.path.split(".");
  let cursor: unknown = input.payload;

  for (const segment of segments) {
    const parsedCursor = TriggerPathCursorSchema.safeParse(cursor);
    if (!parsedCursor.success) {
      return undefined;
    }

    cursor = parsedCursor.data[segment];
  }

  return cursor;
}

export function evaluateTriggerFilter(input: { filter: TriggerFilter; payload: unknown }): boolean {
  const { filter, payload } = input;

  if (filter.op === "all") {
    return filter.filters.every((nestedFilter) =>
      evaluateTriggerFilter({
        filter: nestedFilter,
        payload,
      }),
    );
  }

  if (filter.op === "any") {
    return filter.filters.some((nestedFilter) =>
      evaluateTriggerFilter({
        filter: nestedFilter,
        payload,
      }),
    );
  }

  if (filter.op === "not") {
    return !evaluateTriggerFilter({
      filter: filter.filter,
      payload,
    });
  }

  if (filter.op === "exists") {
    return (
      getValueAtPath({
        payload,
        path: filter.path,
      }) !== undefined
    );
  }

  const resolvedValue = getValueAtPath({
    payload,
    path: filter.path,
  });

  if (filter.op === "eq") {
    return resolvedValue === filter.value;
  }

  if (filter.op === "in") {
    if (typeof resolvedValue !== "string" && typeof resolvedValue !== "number") {
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

  if (filter.op === "startsWith") {
    if (typeof resolvedValue !== "string") {
      return false;
    }

    return resolvedValue.startsWith(filter.value);
  }

  return false;
}

export function parseTriggerRules(input: unknown): ReadonlyArray<TriggerRule> {
  const parsedRules = TriggerRulesSchema.safeParse(input);

  if (!parsedRules.success) {
    throw new IntegrationManifestError(
      ManifestErrorCodes.INVALID_TRIGGER_RULES,
      `Trigger rule validation failed. ${formatIssues(parsedRules.error.issues)}`,
    );
  }

  return parsedRules.data;
}
