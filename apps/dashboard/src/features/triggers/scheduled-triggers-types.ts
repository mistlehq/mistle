import { z } from "zod";

import type { paths } from "../../lib/control-plane-api/generated/schema.js";

type CreateScheduledTriggerRequest =
  paths["/v1/automations/schedules"]["post"]["requestBody"]["content"]["application/json"];
type UpdateScheduledTriggerRequest =
  paths["/v1/automations/schedules/{automationId}"]["patch"]["requestBody"]["content"]["application/json"];

const ScheduledTriggerTargetSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    primaryRepositoryId: z.string().min(1).nullable(),
  })
  .strict();

const ScheduledTriggerScheduleSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    cronExpression: z.string().min(1),
    timezone: z.string().min(1),
    enabled: z.boolean(),
    nextScheduledAt: z.string().min(1).nullable(),
    lastScheduledAt: z.string().min(1).nullable(),
  })
  .strict();

export const ScheduledTriggerSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("schedule"),
    name: z.string().min(1),
    enabled: z.boolean(),
    schedule: ScheduledTriggerScheduleSchema,
    inputTemplate: z.string(),
    conversationKeyTemplate: z.string(),
    idempotencyKeyTemplate: z.string().nullable(),
    target: ScheduledTriggerTargetSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const DeleteScheduledTriggerResultSchema = z
  .object({
    automationId: z.string().min(1),
  })
  .strict()
  .transform(({ automationId }) => ({
    triggerId: automationId,
  }));

export type ScheduledTrigger = z.infer<typeof ScheduledTriggerSchema>;
export type DeleteScheduledTriggerResult = z.infer<typeof DeleteScheduledTriggerResultSchema>;
export type CreateScheduledTriggerInput = CreateScheduledTriggerRequest;
export type UpdateScheduledTriggerPatch = UpdateScheduledTriggerRequest;
export type UpdateScheduledTriggerInput = {
  triggerId: string;
  payload: UpdateScheduledTriggerPatch;
};
