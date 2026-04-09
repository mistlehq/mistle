import { z } from "zod";

export type WebhookPayloadFilterScalar = string | number | boolean | null;

export type WebhookPayloadFilterPath = ReadonlyArray<string>;

export type WebhookPayloadPathInput = string | ReadonlyArray<string>;

export type WebhookPayloadFilter =
  | {
      op: "and";
      filters: ReadonlyArray<WebhookPayloadFilter>;
    }
  | {
      op: "or";
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
      op: "contains_token";
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

export type EventScopedWebhookPayloadFilter = Record<string, WebhookPayloadFilter>;

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
        op: z.literal("and"),
        filters: z.array(WebhookPayloadFilterSchema).min(1),
      })
      .strict(),
    z
      .object({
        op: z.literal("or"),
        filters: z.array(WebhookPayloadFilterSchema).min(1),
      })
      .strict(),
    z
      .object({
        op: z.literal("all"),
        filters: z.array(WebhookPayloadFilterSchema).min(1),
      })
      .strict()
      .transform(
        (value: {
          filters: WebhookPayloadFilter[];
        }): Extract<WebhookPayloadFilter, { op: "and" }> => ({
          op: "and",
          filters: value.filters,
        }),
      ),
    z
      .object({
        op: z.literal("any"),
        filters: z.array(WebhookPayloadFilterSchema).min(1),
      })
      .strict()
      .transform(
        (value: {
          filters: WebhookPayloadFilter[];
        }): Extract<WebhookPayloadFilter, { op: "or" }> => ({
          op: "or",
          filters: value.filters,
        }),
      ),
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
        op: z.literal("contains_token"),
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

export const EventScopedWebhookPayloadFilterSchema = z.record(
  z.string().min(1),
  WebhookPayloadFilterSchema,
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

export function parseEventScopedWebhookPayloadFilter(
  input: unknown,
): EventScopedWebhookPayloadFilter {
  const parsed = EventScopedWebhookPayloadFilterSchema.safeParse(input);

  if (!parsed.success) {
    throw new Error(
      `Event-scoped webhook payload filter validation failed. ${formatIssues(parsed.error.issues)}`,
    );
  }

  return parsed.data;
}
