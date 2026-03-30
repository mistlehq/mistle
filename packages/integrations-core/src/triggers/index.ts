import { z } from "zod";

import { IntegrationTriggerRulesError, TriggerRulesErrorCodes } from "../errors/index.js";
import type { TriggerFilter, TriggerRule } from "../types/index.js";
import { evaluateFilterNode, type SharedFilter } from "./evaluate.js";
import { getValueAtPath, splitDotPath } from "./path.js";

type ValidationIssue = {
  path: ReadonlyArray<PropertyKey>;
  message: string;
};

function formatIssues(issues: ReadonlyArray<ValidationIssue>): string {
  return issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");
}

const TriggerScalarValueSchema = z.union([z.string(), z.number(), z.boolean()]);

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
        op: z.literal("containsToken"),
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

function normalizeTriggerFilter(filter: TriggerFilter): SharedFilter {
  if (filter.op === "all" || filter.op === "any") {
    return {
      op: filter.op,
      filters: filter.filters.map((nestedFilter) => normalizeTriggerFilter(nestedFilter)),
    };
  }

  if (filter.op === "not") {
    return {
      op: "not",
      filter: normalizeTriggerFilter(filter.filter),
    };
  }

  if (filter.op === "exists") {
    return {
      op: "exists",
      path: splitDotPath(filter.path),
    };
  }

  if (filter.op === "eq") {
    return {
      op: "eq",
      path: splitDotPath(filter.path),
      value: filter.value,
    };
  }

  if (filter.op === "in") {
    return {
      op: "in",
      path: splitDotPath(filter.path),
      values: [...filter.values],
    };
  }

  if (filter.op === "contains") {
    return {
      op: "contains",
      path: splitDotPath(filter.path),
      value: filter.value,
    };
  }

  if (filter.op === "containsToken") {
    return {
      op: "containsToken",
      path: splitDotPath(filter.path),
      value: filter.value,
    };
  }

  return {
    op: "startsWith",
    path: splitDotPath(filter.path),
    value: filter.value,
  };
}

export function evaluateTriggerFilter(input: { filter: TriggerFilter; payload: unknown }): boolean {
  const normalizedFilter = normalizeTriggerFilter(input.filter);

  return evaluateFilterNode({
    filter: normalizedFilter,
    resolveValueAtPath(path) {
      return getValueAtPath({
        payload: input.payload,
        path,
        options: {
          allowArrayTraversal: false,
          propertyAccess: "plain",
        },
      });
    },
  });
}

export function parseTriggerRules(input: unknown): ReadonlyArray<TriggerRule> {
  const parsedRules = TriggerRulesSchema.safeParse(input);

  if (!parsedRules.success) {
    throw new IntegrationTriggerRulesError(
      TriggerRulesErrorCodes.INVALID_TRIGGER_RULES,
      `Trigger rule validation failed. ${formatIssues(parsedRules.error.issues)}`,
    );
  }

  return parsedRules.data;
}

export * from "./evaluate.js";
export * from "./operators.js";
export * from "./path.js";
