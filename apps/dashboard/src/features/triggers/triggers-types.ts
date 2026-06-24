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

export const WebhookTriggerActivityItemSchema = z
  .object({
    id: z.string().min(1),
    sourceOccurredAt: z.string().min(1).nullable(),
    finalizedAt: z.string().min(1).nullable(),
    eventType: z.string().min(1),
    providerEventType: z.string().min(1),
    externalDeliveryId: z.string().min(1).nullable(),
    status: z.enum(["received", "processing", "processed", "failed", "ignored", "duplicate"]),
  })
  .strict();

export const ScheduledTriggerActivityItemSchema = z
  .object({
    id: z.string().min(1),
    scheduledAt: z.string().min(1),
    localScheduledDate: z.string().min(1),
    localScheduledTime: z.string().min(1),
    status: z.enum(["pending", "dispatching", "dispatched", "failed", "skipped_late"]),
  })
  .strict();

export const TriggerActivityResultSchema = z.union([
  z
    .object({
      kind: z.literal("webhook"),
      items: z.array(WebhookTriggerActivityItemSchema),
    })
    .strict(),
  z
    .object({
      kind: z.literal("schedule"),
      items: z.array(ScheduledTriggerActivityItemSchema),
    })
    .strict(),
]);

export type TriggerListIssue = z.infer<typeof TriggerListIssueSchema>;
export type TriggerListEvent = z.infer<typeof TriggerListEventSchema>;
export type TriggerListItem = z.infer<typeof TriggerListItemSchema>;
export type TriggersListResult = z.infer<typeof TriggersListResultSchema>;
export type WebhookTriggerActivityItem = z.infer<typeof WebhookTriggerActivityItemSchema>;
export type ScheduledTriggerActivityItem = z.infer<typeof ScheduledTriggerActivityItemSchema>;
export type TriggerActivityResult = z.infer<typeof TriggerActivityResultSchema>;
