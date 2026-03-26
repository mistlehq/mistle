import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { AutomationWebhooksBadRequestCodes } from "../constants.js";

export const CreateAutomationWebhookBodySchema = z
  .object({
    name: z.string().min(1),
    enabled: z.boolean().optional(),
    integrationConnectionId: z.string().min(1),
    eventTypes: z.array(z.string().min(1)).min(1).nullable().optional(),
    payloadFilter: z.record(z.string(), z.unknown()).nullable().optional(),
    inputTemplate: z.string().min(1),
    conversationKeyTemplate: z.string().min(1),
    idempotencyKeyTemplate: z.string().min(1).nullable().optional(),
    target: z
      .object({
        sandboxProfileId: z.string().min(1),
        sandboxProfileVersion: z.number().int().min(1).optional(),
      })
      .strict(),
  })
  .strict();

const CreateAutomationWebhookBadRequestCodeSchema = z.enum([
  AutomationWebhooksBadRequestCodes.INVALID_CONNECTION_REFERENCE,
  AutomationWebhooksBadRequestCodes.CONNECTION_TARGET_NOT_WEBHOOK_CAPABLE,
  AutomationWebhooksBadRequestCodes.INVALID_SANDBOX_PROFILE_REFERENCE,
  AutomationWebhooksBadRequestCodes.INVALID_SANDBOX_PROFILE_TRIGGER_REFERENCE,
]);

export const CreateAutomationWebhookBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(CreateAutomationWebhookBadRequestCodeSchema),
  ValidationErrorResponseSchema,
]);
