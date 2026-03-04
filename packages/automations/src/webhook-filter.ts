import { z } from "zod";

export type WebhookPayloadFilterScalar = string | number | boolean | null;

export type WebhookPayloadFilterPath = ReadonlyArray<string>;

export type WebhookPayloadFilter =
  | {
      op: "all";
      filters: ReadonlyArray<WebhookPayloadFilter>;
    }
  | {
      op: "any";
      filters: ReadonlyArray<WebhookPayloadFilter>;
    }
  | {
      op: "not";
      filter: WebhookPayloadFilter;
    }
  | {
      op: "eq";
      path: WebhookPayloadFilterPath;
      value: WebhookPayloadFilterScalar;
    }
  | {
      op: "neq";
      path: WebhookPayloadFilterPath;
      value: WebhookPayloadFilterScalar;
    }
  | {
      op: "in";
      path: WebhookPayloadFilterPath;
      values: ReadonlyArray<WebhookPayloadFilterScalar>;
    }
  | {
      op: "contains";
      path: WebhookPayloadFilterPath;
      value: string;
    }
  | {
      op: "starts_with";
      path: WebhookPayloadFilterPath;
      value: string;
    }
  | {
      op: "ends_with";
      path: WebhookPayloadFilterPath;
      value: string;
    }
  | {
      op: "exists";
      path: WebhookPayloadFilterPath;
    }
  | {
      op: "not_exists";
      path: WebhookPayloadFilterPath;
    };

const WebhookPayloadFilterScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const WebhookPayloadFilterPathSchema = z.array(z.string().min(1)).min(1);

type ValidationIssue = {
  path: ReadonlyArray<PropertyKey>;
  message: string;
};

function formatIssues(issues: ReadonlyArray<ValidationIssue>): string {
  return issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");
}

export const WebhookPayloadFilterSchema: z.ZodType<WebhookPayloadFilter> = z.lazy(() =>
  z.union([
    z
      .object({
        op: z.literal("all"),
        filters: z.array(WebhookPayloadFilterSchema).min(1),
      })
      .strict(),
    z
      .object({
        op: z.literal("any"),
        filters: z.array(WebhookPayloadFilterSchema).min(1),
      })
      .strict(),
    z
      .object({
        op: z.literal("not"),
        filter: WebhookPayloadFilterSchema,
      })
      .strict(),
    z
      .object({
        op: z.literal("eq"),
        path: WebhookPayloadFilterPathSchema,
        value: WebhookPayloadFilterScalarSchema,
      })
      .strict(),
    z
      .object({
        op: z.literal("neq"),
        path: WebhookPayloadFilterPathSchema,
        value: WebhookPayloadFilterScalarSchema,
      })
      .strict(),
    z
      .object({
        op: z.literal("in"),
        path: WebhookPayloadFilterPathSchema,
        values: z.array(WebhookPayloadFilterScalarSchema).min(1),
      })
      .strict(),
    z
      .object({
        op: z.literal("contains"),
        path: WebhookPayloadFilterPathSchema,
        value: z.string(),
      })
      .strict(),
    z
      .object({
        op: z.literal("starts_with"),
        path: WebhookPayloadFilterPathSchema,
        value: z.string(),
      })
      .strict(),
    z
      .object({
        op: z.literal("ends_with"),
        path: WebhookPayloadFilterPathSchema,
        value: z.string(),
      })
      .strict(),
    z
      .object({
        op: z.literal("exists"),
        path: WebhookPayloadFilterPathSchema,
      })
      .strict(),
    z
      .object({
        op: z.literal("not_exists"),
        path: WebhookPayloadFilterPathSchema,
      })
      .strict(),
  ]),
);

export function parseWebhookPayloadFilter(input: unknown): WebhookPayloadFilter {
  const parsed = WebhookPayloadFilterSchema.safeParse(input);

  if (!parsed.success) {
    throw new Error(
      `Webhook payload filter validation failed. ${formatIssues(parsed.error.issues)}`,
    );
  }

  return parsed.data;
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

    cursor = Reflect.get(cursor, segment);
  }

  return cursor;
}

function isWebhookPayloadFilterScalar(value: unknown): value is WebhookPayloadFilterScalar {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

export function evaluateWebhookPayloadFilter(input: {
  filter: WebhookPayloadFilter;
  payload: unknown;
}): boolean {
  const { filter, payload } = input;

  if (filter.op === "all") {
    return filter.filters.every((nestedFilter) =>
      evaluateWebhookPayloadFilter({
        filter: nestedFilter,
        payload,
      }),
    );
  }

  if (filter.op === "any") {
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
