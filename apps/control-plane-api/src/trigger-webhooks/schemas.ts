import { z } from "@hono/zod-openapi";

export const TriggerWebhookTargetSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    primaryRepositoryId: z.string().min(1).nullable(),
  })
  .strict();

export const TriggerWebhookSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("webhook"),
    name: z.string().min(1),
    enabled: z.boolean(),
    integrationWebhookSourceId: z.string().min(1),
    eventTypes: z.array(z.string().min(1)).nullable(),
    payloadFilter: z.record(z.string(), z.unknown()).nullable(),
    inputTemplate: z.string().min(1),
    instructions: z.string().min(1).nullable(),
    conversationKeyTemplate: z.string().min(1),
    idempotencyKeyTemplate: z.string().min(1).nullable(),
    target: TriggerWebhookTargetSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const TriggerWebhookParamsSchema = z
  .object({
    triggerId: z
      .string()
      .min(1)
      .regex(/^(?:atm|trg)_[a-zA-Z0-9_-]+$/, {
        message: "`triggerId` must be a trigger id.",
      }),
  })
  .strict();
