import { z } from "zod";

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
    automationId: z.string().min(1),
  })
  .strict()
  .transform(({ automationId }) => ({
    triggerId: automationId,
  }));

export type WebhookTrigger = z.infer<typeof WebhookTriggerSchema>;
export type DeleteWebhookTriggerResult = z.infer<typeof DeleteWebhookTriggerResultSchema>;

export type CreateWebhookTriggerInput = {
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

export type UpdateWebhookTriggerPatch = {
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

export type UpdateWebhookTriggerInput = {
  triggerId: string;
  payload: UpdateWebhookTriggerPatch;
};
