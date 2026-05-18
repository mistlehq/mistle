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

export const WebhookTriggerSchema = z
  .object({
    conversationKeyTemplate: z.string(),
    createdAt: z.string().min(1),
    enabled: z.boolean(),
    eventTypes: z.array(z.string()).nullable(),
    id: z.string().min(1),
    idempotencyKeyTemplate: z.string().nullable(),
    inputTemplate: z.string(),
    instructions: z.string().nullable(),
    integrationWebhookSourceId: z.string().min(1),
    kind: z.literal("webhook"),
    name: z.string().min(1),
    payloadFilter: z.record(z.string(), z.unknown()).nullable(),
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
export type DeleteWebhookTriggerResult = z.infer<typeof DeleteWebhookTriggerResultSchema>;

export type CreateWebhookTriggerInput = CreateWebhookTriggerRequest;
export type UpdateWebhookTriggerPatch = UpdateWebhookTriggerRequest;

export type UpdateWebhookTriggerInput = {
  triggerId: string;
  payload: UpdateWebhookTriggerPatch;
};
