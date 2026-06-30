import { z } from "zod";

import type { paths } from "../../lib/control-plane-api/generated/schema.js";

type CreateWebhookTriggerRequest =
  paths["/v1/triggers/webhooks"]["post"]["requestBody"]["content"]["application/json"];
type UpdateWebhookTriggerRequest =
  paths["/v1/triggers/webhooks/{triggerId}"]["patch"]["requestBody"]["content"]["application/json"];

const WebhookTriggerTargetSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    primaryRepositoryId: z.string().min(1).nullable(),
  })
  .strict();

const WebhookTriggerActorPolicyResourceReferenceSchema = z.union([
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

const WebhookTriggerActorPolicyRuleSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("resource"),
      actor: WebhookTriggerActorPolicyResourceReferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("relationship"),
      relationshipKind: z.string().min(1),
      actorSet: WebhookTriggerActorPolicyResourceReferenceSchema,
      scope: WebhookTriggerActorPolicyResourceReferenceSchema,
    })
    .strict(),
]);

const WebhookTriggerActorPolicyRuleListSchema = z.array(WebhookTriggerActorPolicyRuleSchema).min(1);

const WebhookTriggerActorPolicySchema = z.union([
  z
    .object({
      anyOf: WebhookTriggerActorPolicyRuleListSchema,
      noneOf: WebhookTriggerActorPolicyRuleListSchema.optional(),
    })
    .strict(),
  z
    .object({
      anyOf: WebhookTriggerActorPolicyRuleListSchema.optional(),
      noneOf: WebhookTriggerActorPolicyRuleListSchema,
    })
    .strict(),
]);

const WebhookTriggerEventConditionSchema = z
  .object({
    eventType: z.string().min(1),
    actorPolicy: WebhookTriggerActorPolicySchema.optional(),
    payloadFilter: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const WebhookTriggerSchema = z
  .object({
    conversationKeyTemplate: z.string(),
    createdAt: z.string().min(1),
    enabled: z.boolean(),
    eventConditions: z.array(WebhookTriggerEventConditionSchema).min(1),
    id: z.string().min(1),
    idempotencyKeyTemplate: z.string().nullable(),
    inputTemplate: z.string(),
    instructions: z.string().nullable(),
    integrationWebhookSourceId: z.string().min(1),
    kind: z.literal("webhook"),
    name: z.string().min(1),
    target: WebhookTriggerTargetSchema,
    updatedAt: z.string().min(1),
  })
  .strict();

export const DeleteWebhookTriggerResultSchema = z
  .object({
    triggerId: z.string().min(1),
  })
  .strict();

export type WebhookTrigger = z.infer<typeof WebhookTriggerSchema>;
export type WebhookTriggerActorPolicy = z.infer<typeof WebhookTriggerActorPolicySchema>;
export type DeleteWebhookTriggerResult = z.infer<typeof DeleteWebhookTriggerResultSchema>;

export type CreateWebhookTriggerInput = CreateWebhookTriggerRequest;
export type UpdateWebhookTriggerPatch = UpdateWebhookTriggerRequest;

export type UpdateWebhookTriggerInput = {
  triggerId: string;
  payload: UpdateWebhookTriggerPatch;
};
