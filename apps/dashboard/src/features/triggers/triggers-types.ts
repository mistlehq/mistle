import { z } from "zod";

import type { paths } from "../../lib/control-plane-api/generated/schema.js";

export type ListTriggersQuery = NonNullable<paths["/v1/triggers"]["get"]["parameters"]["query"]>;

export const TriggerListIssueSchema = z
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

export const TriggerListEventSchema = z
  .object({
    label: z.string().min(1),
    logoKey: z.string().min(1).optional(),
    unavailable: z.boolean().optional(),
  })
  .strict();

const TriggerListTargetSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    sandboxProfileName: z.string().min(1).nullable(),
    sandboxProfileVersion: z.number().int().min(1),
    primaryRepositoryId: z.string().min(1).nullable(),
    primaryRepositoryName: z.string().min(1).nullable(),
  })
  .strict();

const TriggerListWebhookSourceSchema = z
  .object({
    kind: z.literal("webhook"),
    events: z.array(TriggerListEventSchema),
  })
  .strict();

const TriggerListScheduleSourceSchema = z
  .object({
    kind: z.literal("schedule"),
    cronExpression: z.string().min(1),
    timezone: z.string().min(1),
    nextScheduledAt: z.string().min(1).nullable(),
  })
  .strict();

export const TriggerListItemSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["webhook", "schedule"]),
    name: z.string().min(1),
    enabled: z.boolean(),
    target: TriggerListTargetSchema,
    issue: TriggerListIssueSchema.optional(),
    source: z.union([TriggerListWebhookSourceSchema, TriggerListScheduleSourceSchema]),
    updatedAt: z.string().min(1),
  })
  .strict();

export const TriggersListResultSchema = z
  .object({
    items: z.array(TriggerListItemSchema),
    nextPage: KeysetPageSchema.nullable(),
    previousPage: PreviousPageSchema.nullable(),
    totalResults: z.number().int().min(0),
  })
  .strict();

export type TriggerListIssue = z.infer<typeof TriggerListIssueSchema>;
export type TriggerListEvent = z.infer<typeof TriggerListEventSchema>;
export type TriggerListItem = z.infer<typeof TriggerListItemSchema>;
export type TriggersListResult = z.infer<typeof TriggersListResultSchema>;
