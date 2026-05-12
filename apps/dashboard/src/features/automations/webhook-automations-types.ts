import { z } from "zod";

const WebhookAutomationTargetSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    primaryRepositoryId: z.string().min(1).nullable(),
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
    instructions: z.string().nullable(),
    integrationWebhookSourceId: z.string().min(1),
    kind: z.literal("webhook"),
    name: z.string().min(1),
    payloadFilter: z.record(z.string(), z.unknown()).nullable(),
    target: WebhookAutomationTargetSchema,
    updatedAt: z.string().min(1),
  })
  .strict();

export const DeleteWebhookAutomationResultSchema = z
  .object({
    automationId: z.string().min(1),
  })
  .strict();

export type WebhookAutomation = z.infer<typeof WebhookAutomationSchema>;
export type DeleteWebhookAutomationResult = z.infer<typeof DeleteWebhookAutomationResultSchema>;

export type CreateWebhookAutomationInput = {
  name: string;
  enabled?: boolean;
  integrationWebhookSourceId: string;
  eventTypes?: string[] | null;
  payloadFilter?: Record<string, unknown> | null;
  inputTemplate: string;
  instructions?: string | null;
  conversationKeyTemplate: string;
  idempotencyKeyTemplate?: string | null;
  target: {
    sandboxProfileId: string;
    sandboxProfileVersion?: number;
    primaryRepositoryId?: string | null;
  };
};

export type UpdateWebhookAutomationPatch = {
  name?: string;
  enabled?: boolean;
  integrationWebhookSourceId?: string;
  eventTypes?: string[] | null;
  payloadFilter?: Record<string, unknown> | null;
  inputTemplate?: string;
  instructions?: string | null;
  conversationKeyTemplate?: string;
  idempotencyKeyTemplate?: string | null;
  target?: {
    sandboxProfileId?: string;
    sandboxProfileVersion?: number;
    primaryRepositoryId?: string | null;
  };
};

export type UpdateWebhookAutomationInput = {
  automationId: string;
  payload: UpdateWebhookAutomationPatch;
};
