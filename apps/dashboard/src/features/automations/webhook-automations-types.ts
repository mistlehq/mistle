import { z } from "zod";

import type { paths } from "../../lib/control-plane-api/generated/schema.js";

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

const WebhookAutomationTargetSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1).nullable(),
  })
  .strict();

export const WebhookAutomationSchema = z
  .object({
    conversationKeyTemplate: z.string(),
    createdAt: z.string().min(1),
    enabled: z.boolean(),
    eventTypes: z.array(z.string()).nullable(),
    id: z.string().min(1),
    idempotencyKeyTemplate: z.string().nullable(),
    inputTemplate: z.string(),
    integrationConnectionId: z.string().min(1),
    kind: z.literal("webhook"),
    name: z.string().min(1),
    payloadFilter: z.record(z.string(), z.unknown()).nullable(),
    target: WebhookAutomationTargetSchema,
    updatedAt: z.string().min(1),
  })
  .strict();

export const WebhookAutomationsListResultSchema = z
  .object({
    items: z.array(WebhookAutomationSchema),
    nextPage: KeysetPageSchema.nullable(),
    previousPage: PreviousPageSchema.nullable(),
    totalResults: z.number().int().min(0),
  })
  .strict();

export const DeleteWebhookAutomationResultSchema = z
  .object({
    automationId: z.string().min(1),
  })
  .strict();

export type WebhookAutomation = z.infer<typeof WebhookAutomationSchema>;
export type WebhookAutomationsListResult = z.infer<typeof WebhookAutomationsListResultSchema>;
export type DeleteWebhookAutomationResult = z.infer<typeof DeleteWebhookAutomationResultSchema>;

export type CreateWebhookAutomationInput =
  paths["/v1/automations/webhooks"]["post"]["requestBody"]["content"]["application/json"];

export type UpdateWebhookAutomationPatch =
  paths["/v1/automations/webhooks/{automationId}"]["patch"]["requestBody"]["content"]["application/json"];

export type UpdateWebhookAutomationInput = {
  automationId: string;
  payload: UpdateWebhookAutomationPatch;
};
