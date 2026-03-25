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

export const WebhookAutomationListEventSchema = z
  .object({
    label: z.string().min(1),
    logoKey: z.string().min(1).optional(),
    unavailable: z.boolean().optional(),
  })
  .strict();

export const WebhookAutomationListIssueSchema = z
  .object({
    code: z.enum([
      "MISSING_TARGET_METADATA",
      "MISSING_INTEGRATION_CONNECTION",
      "MISSING_SANDBOX_PROFILE",
    ]),
    message: z.string().min(1),
  })
  .strict();

export const WebhookAutomationListItemSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    enabled: z.boolean(),
    targetName: z.string().min(1),
    issue: WebhookAutomationListIssueSchema.optional(),
    events: z.array(WebhookAutomationListEventSchema),
    updatedAt: z.string().min(1),
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
    items: z.array(WebhookAutomationListItemSchema),
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
export type WebhookAutomationListEvent = z.infer<typeof WebhookAutomationListEventSchema>;
export type WebhookAutomationListIssue = z.infer<typeof WebhookAutomationListIssueSchema>;
export type WebhookAutomationListItem = z.infer<typeof WebhookAutomationListItemSchema>;
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
