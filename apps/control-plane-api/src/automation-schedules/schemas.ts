import { z } from "@hono/zod-openapi";

export const AutomationScheduleTargetSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    primaryRepositoryId: z.string().min(1).nullable(),
  })
  .strict();

export const AutomationScheduleScheduleSchema = z
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

export const AutomationScheduleSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("schedule"),
    name: z.string().min(1),
    enabled: z.boolean(),
    schedule: AutomationScheduleScheduleSchema,
    inputTemplate: z.string().min(1),
    conversationKeyTemplate: z.string().min(1),
    idempotencyKeyTemplate: z.string().min(1).nullable(),
    target: AutomationScheduleTargetSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const AutomationScheduleParamsSchema = z
  .object({
    automationId: z
      .string()
      .min(1)
      .regex(/^atm_[a-zA-Z0-9_-]+$/, {
        message: "`automationId` must be an automation id.",
      }),
  })
  .strict();
