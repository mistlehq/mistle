import { z } from "@hono/zod-openapi";

export const TriggerScheduleTargetSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    primaryRepositoryId: z.string().min(1).nullable(),
  })
  .strict();

export const TriggerScheduleScheduleSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["recurring", "one_off"]),
    name: z.string().min(1),
    cronExpression: z.string().min(1).nullable(),
    timezone: z.string().min(1).nullable(),
    enabled: z.boolean(),
    nextScheduledAt: z.string().min(1).nullable(),
    lastScheduledAt: z.string().min(1).nullable(),
    startAt: z.string().min(1).nullable(),
  })
  .strict();

export const TriggerScheduleSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("schedule"),
    name: z.string().min(1),
    enabled: z.boolean(),
    schedule: TriggerScheduleScheduleSchema,
    inputTemplate: z.string().min(1),
    conversationKeyTemplate: z.string().min(1),
    idempotencyKeyTemplate: z.string().min(1).nullable(),
    target: TriggerScheduleTargetSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const TriggerScheduleParamsSchema = z
  .object({
    triggerId: z
      .string()
      .min(1)
      .regex(/^(?:atm|trg)_[a-zA-Z0-9_-]+$/, {
        message: "`triggerId` must be a trigger id.",
      }),
  })
  .strict();
