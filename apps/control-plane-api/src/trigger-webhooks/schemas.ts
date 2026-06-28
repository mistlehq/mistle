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

const TriggerWebhookActorPolicyAttributeRuleSchema = z
  .object({
    kind: z.literal("attribute"),
    attributeKey: z.string().min(1),
    attributeValue: z.string().min(1),
    valueType: z.enum(["boolean", "number", "string"]),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (
      rule.valueType === "boolean" &&
      rule.attributeValue !== "true" &&
      rule.attributeValue !== "false"
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Boolean actor policy attribute values must be exactly 'true' or 'false'.",
        path: ["attributeValue"],
      });
      return;
    }

    if (rule.valueType === "number") {
      const numericValue = Number(rule.attributeValue);
      if (!Number.isFinite(numericValue) || String(numericValue) !== rule.attributeValue) {
        ctx.addIssue({
          code: "custom",
          message:
            "Number actor policy attribute values must be canonical finite JavaScript numbers.",
          path: ["attributeValue"],
        });
      }
    }
  });

export const TriggerWebhookActorPolicyRuleSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("resource"),
      actor: TriggerWebhookActorPolicyResourceReferenceSchema,
    })
    .strict(),
  TriggerWebhookActorPolicyAttributeRuleSchema,
  z
    .object({
      kind: z.literal("relationship"),
      relationshipKind: z.string().min(1),
      actorSet: TriggerWebhookActorPolicyResourceReferenceSchema,
      scope: TriggerWebhookActorPolicyResourceReferenceSchema,
    })
    .strict(),
]);

export const TriggerWebhookActorPolicySchema = z
  .object({
    anyOf: z.array(TriggerWebhookActorPolicyRuleSchema).min(1),
  })
  .strict();

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
