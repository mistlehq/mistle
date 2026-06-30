import { z } from "@hono/zod-openapi";

export const TriggerWebhookTargetSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    primaryRepositoryId: z.string().min(1).nullable(),
  })
  .strict();

export const TriggerWebhookActorPolicyResourceReferenceSchema = z.union([
  z
    .object({
      resourceKind: z.string().min(1),
      resourceId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      resourceKind: z.string().min(1),
      externalId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      resourceKind: z.string().min(1),
      handle: z.string().min(1),
    })
    .strict(),
]);

export const TriggerWebhookActorPolicyRuleSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("resource"),
      actor: TriggerWebhookActorPolicyResourceReferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("relationship"),
      relationshipKind: z.string().min(1),
      actorSet: TriggerWebhookActorPolicyResourceReferenceSchema,
      scope: TriggerWebhookActorPolicyResourceReferenceSchema,
    })
    .strict(),
]);

const TriggerWebhookActorPolicyRuleListSchema = z.array(TriggerWebhookActorPolicyRuleSchema).min(1);

export const TriggerWebhookActorPolicySchema = z.union([
  z
    .object({
      anyOf: TriggerWebhookActorPolicyRuleListSchema,
      noneOf: TriggerWebhookActorPolicyRuleListSchema.optional(),
    })
    .strict(),
  z
    .object({
      anyOf: TriggerWebhookActorPolicyRuleListSchema.optional(),
      noneOf: TriggerWebhookActorPolicyRuleListSchema,
    })
    .strict(),
]);

export const TriggerWebhookEventConditionSchema = z
  .object({
    eventType: z.string().min(1),
    actorPolicy: TriggerWebhookActorPolicySchema.optional(),
    payloadFilter: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

export const TriggerWebhookSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("webhook"),
    name: z.string().min(1),
    enabled: z.boolean(),
    integrationWebhookSourceId: z.string().min(1),
    eventConditions: z.array(TriggerWebhookEventConditionSchema).min(1),
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
