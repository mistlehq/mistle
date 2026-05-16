import { z } from "@hono/zod-openapi";

export const AutomationListIssueSchema = z
  .object({
    code: z.enum([
      "MISSING_TARGET_METADATA",
      "MISSING_WEBHOOK_SOURCE",
      "MISSING_INTEGRATION_CONNECTION",
      "MISSING_SANDBOX_PROFILE",
    ]),
    message: z.string().min(1),
  })
  .strict();

export const AutomationListTargetSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    sandboxProfileName: z.string().min(1).nullable(),
    sandboxProfileVersion: z.number().int().min(1),
    primaryRepositoryId: z.string().min(1).nullable(),
    primaryRepositoryName: z.string().min(1).nullable(),
  })
  .strict();

export const AutomationListWebhookEventSchema = z
  .object({
    label: z.string().min(1),
    logoKey: z.string().min(1).optional(),
    unavailable: z.boolean().optional(),
  })
  .strict();

export const AutomationListWebhookSourceSchema = z
  .object({
    kind: z.literal("webhook"),
    events: z.array(AutomationListWebhookEventSchema),
  })
  .strict();

export const AutomationListScheduleSourceSchema = z
  .object({
    kind: z.literal("schedule"),
    cronExpression: z.string().min(1),
    timezone: z.string().min(1),
    nextScheduledAt: z.string().min(1).nullable(),
  })
  .strict();

export const AutomationListItemSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["webhook", "schedule"]),
    name: z.string().min(1),
    enabled: z.boolean(),
    target: AutomationListTargetSchema,
    issue: AutomationListIssueSchema.optional(),
    source: z.union([AutomationListWebhookSourceSchema, AutomationListScheduleSourceSchema]),
    updatedAt: z.string().min(1),
  })
  .strict();

export const AutomationParamsSchema = z
  .object({
    automationId: z
      .string()
      .min(1)
      .regex(/^atm_[a-zA-Z0-9_-]+$/, {
        message: "`automationId` must be an automation id.",
      }),
  })
  .strict();
