import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { TriggerWebhooksBadRequestCodes } from "../constants.js";

export const CreateTriggerWebhookBodySchema = z
  .object({
    name: z.string().min(1),
    enabled: z.boolean().optional(),
    integrationWebhookSourceId: z.string().min(1),
    eventTypes: z.array(z.string().min(1)).min(1).nullable().optional(),
    payloadFilter: z.record(z.string(), z.unknown()).nullable().optional(),
    inputTemplate: z.string().min(1),
    instructions: z.string().min(1).nullable().optional(),
    conversationKeyTemplate: z.string().min(1),
    idempotencyKeyTemplate: z.string().min(1).nullable().optional(),
    target: z
      .object({
        sandboxProfileId: z.string().min(1),
        sandboxProfileVersion: z.number().int().min(1).optional(),
        primaryRepositoryId: z.string().min(1).nullable().optional(),
      })
      .strict(),
  })
  .strict();

const CreateTriggerWebhookBadRequestCodeSchema = z.enum([
  TriggerWebhooksBadRequestCodes.INVALID_WEBHOOK_SOURCE_REFERENCE,
  TriggerWebhooksBadRequestCodes.INVALID_WEBHOOK_TRIGGER_REQUIREMENTS,
  TriggerWebhooksBadRequestCodes.WEBHOOK_SOURCE_TARGET_NOT_WEBHOOK_CAPABLE,
  TriggerWebhooksBadRequestCodes.INVALID_SANDBOX_PROFILE_REFERENCE,
  TriggerWebhooksBadRequestCodes.INVALID_SANDBOX_PROFILE_TRIGGER_REFERENCE,
  TriggerWebhooksBadRequestCodes.INVALID_PRIMARY_REPOSITORY,
]);

export const CreateTriggerWebhookBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(CreateTriggerWebhookBadRequestCodeSchema),
  ValidationErrorResponseSchema,
]);
