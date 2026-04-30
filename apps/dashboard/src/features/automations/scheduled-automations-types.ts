import { z } from "zod";

import type { paths } from "../../lib/control-plane-api/generated/schema.js";

type CreateScheduledAutomationRequest =
  paths["/v1/automations/schedules"]["post"]["requestBody"]["content"]["application/json"];
type UpdateScheduledAutomationRequest =
  paths["/v1/automations/schedules/{automationId}"]["patch"]["requestBody"]["content"]["application/json"];

const ScheduledAutomationTargetSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    primaryRepositoryId: z.string().min(1).nullable(),
  })
  .strict();

const ScheduledAutomationScheduleSchema = z
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

export const ScheduledAutomationSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("schedule"),
    name: z.string().min(1),
    enabled: z.boolean(),
    schedule: ScheduledAutomationScheduleSchema,
    inputTemplate: z.string(),
    conversationKeyTemplate: z.string(),
    idempotencyKeyTemplate: z.string().nullable(),
    target: ScheduledAutomationTargetSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const DeleteScheduledAutomationResultSchema = z
  .object({
    automationId: z.string().min(1),
  })
  .strict();

export type ScheduledAutomation = z.infer<typeof ScheduledAutomationSchema>;
export type DeleteScheduledAutomationResult = z.infer<typeof DeleteScheduledAutomationResultSchema>;
export type CreateScheduledAutomationInput = CreateScheduledAutomationRequest;
export type UpdateScheduledAutomationPatch = UpdateScheduledAutomationRequest;
export type UpdateScheduledAutomationInput = {
  automationId: string;
  payload: UpdateScheduledAutomationPatch;
};
