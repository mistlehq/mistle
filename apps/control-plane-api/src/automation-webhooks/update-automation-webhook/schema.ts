import { z } from "@hono/zod-openapi";

import {
  AutomationWebhookParamsSchema,
  AutomationWebhookSchema,
  AutomationWebhooksBadRequestResponseSchema,
  AutomationWebhooksForbiddenResponseSchema,
  AutomationWebhooksNotFoundResponseSchema,
  AutomationWebhooksUnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "../shared-schemas.js";

export {
  AutomationWebhookParamsSchema,
  AutomationWebhookSchema,
  AutomationWebhooksForbiddenResponseSchema,
  AutomationWebhooksNotFoundResponseSchema,
  AutomationWebhooksUnauthorizedResponseSchema,
};

export const UpdateAutomationWebhookBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    integrationConnectionId: z.string().min(1).optional(),
    eventTypes: z.array(z.string().min(1)).min(1).nullable().optional(),
    payloadFilter: z.record(z.string(), z.unknown()).nullable().optional(),
    inputTemplate: z.string().min(1).optional(),
    conversationKeyTemplate: z.string().min(1).optional(),
    idempotencyKeyTemplate: z.string().min(1).nullable().optional(),
    target: z
      .object({
        sandboxProfileId: z.string().min(1).optional(),
        sandboxProfileVersion: z.number().int().min(1).nullable().optional(),
      })
      .strict()
      .refine(
        (value) =>
          value.sandboxProfileId !== undefined || value.sandboxProfileVersion !== undefined,
        {
          message: "At least one target field must be provided.",
        },
      )
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.enabled !== undefined ||
      value.integrationConnectionId !== undefined ||
      value.eventTypes !== undefined ||
      value.payloadFilter !== undefined ||
      value.inputTemplate !== undefined ||
      value.conversationKeyTemplate !== undefined ||
      value.idempotencyKeyTemplate !== undefined ||
      value.target !== undefined,
    {
      message: "At least one field must be provided.",
    },
  );

export const UpdateAutomationWebhookBadRequestResponseSchema = z.union([
  AutomationWebhooksBadRequestResponseSchema,
  ValidationErrorResponseSchema,
]);
