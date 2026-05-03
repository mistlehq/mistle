import { z } from "zod";

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

const KeysetPageSchema = z
  .object({
    after: z.string().min(1),
    limit: z.number().int().min(1),
  })
  .strict();

const PreviousPageSchema = z
  .object({
    before: z.string().min(1),
    limit: z.number().int().min(1),
  })
  .strict();

export const AutomationListEventSchema = z
  .object({
    label: z.string().min(1),
    logoKey: z.string().min(1).optional(),
    unavailable: z.boolean().optional(),
  })
  .strict();

const AutomationListTargetSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    sandboxProfileName: z.string().min(1).nullable(),
    primaryRepositoryId: z.string().min(1).nullable(),
    primaryRepositoryName: z.string().min(1).nullable(),
  })
  .strict();

const AutomationListWebhookSourceSchema = z
  .object({
    kind: z.literal("webhook"),
    events: z.array(AutomationListEventSchema),
  })
  .strict();

const AutomationListScheduleSourceSchema = z
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

export const AutomationsListResultSchema = z
  .object({
    items: z.array(AutomationListItemSchema),
    nextPage: KeysetPageSchema.nullable(),
    previousPage: PreviousPageSchema.nullable(),
    totalResults: z.number().int().min(0),
  })
  .strict();

export type AutomationListIssue = z.infer<typeof AutomationListIssueSchema>;
export type AutomationListEvent = z.infer<typeof AutomationListEventSchema>;
export type AutomationListItem = z.infer<typeof AutomationListItemSchema>;
export type AutomationsListResult = z.infer<typeof AutomationsListResultSchema>;
