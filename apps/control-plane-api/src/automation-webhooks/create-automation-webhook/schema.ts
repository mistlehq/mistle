import { z } from "@hono/zod-openapi";

import {
  AutomationWebhookSchema,
  AutomationWebhooksBadRequestResponseSchema,
  AutomationWebhooksForbiddenResponseSchema,
  AutomationWebhooksUnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "../schemas.js";

export { AutomationWebhookSchema };
export { AutomationWebhooksForbiddenResponseSchema, AutomationWebhooksUnauthorizedResponseSchema };

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
        sandboxProfileVersion: z.number().int().min(1).nullable().optional(),
      })
      .strict(),
  })
  .strict();

export const CreateAutomationWebhookBadRequestResponseSchema = z.union([
  AutomationWebhooksBadRequestResponseSchema,
  ValidationErrorResponseSchema,
]);
