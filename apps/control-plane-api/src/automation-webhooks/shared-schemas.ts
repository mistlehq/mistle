import { z } from "@hono/zod-openapi";

import { AutomationWebhooksBadRequestCodes, AutomationWebhooksNotFoundCodes } from "./errors.js";

export const AutomationWebhookTargetSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1).nullable(),
  })
  .strict();

export const AutomationWebhookSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("webhook"),
    name: z.string().min(1),
    enabled: z.boolean(),
    integrationConnectionId: z.string().min(1),
    eventTypes: z.array(z.string().min(1)).nullable(),
    payloadFilter: z.record(z.string(), z.unknown()).nullable(),
    inputTemplate: z.string().min(1),
    conversationKeyTemplate: z.string().min(1),
    idempotencyKeyTemplate: z.string().min(1).nullable(),
    target: AutomationWebhookTargetSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const AutomationWebhookParamsSchema = z
  .object({
    automationId: z
      .string()
      .min(1)
      .regex(/^atm_[a-zA-Z0-9_-]+$/, {
        message: "`automationId` must be an automation id.",
      }),
  })
  .strict();

export const ValidationErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.looseObject({
      name: z.string().min(1),
      message: z.string().min(1),
    }),
  })
  .strict();

const BadRequestCodeSchema = z.enum([
  AutomationWebhooksBadRequestCodes.INVALID_LIST_WEBHOOK_AUTOMATIONS_INPUT,
  AutomationWebhooksBadRequestCodes.INVALID_PAGINATION_CURSOR,
  AutomationWebhooksBadRequestCodes.INVALID_CONNECTION_REFERENCE,
  AutomationWebhooksBadRequestCodes.CONNECTION_TARGET_NOT_WEBHOOK_CAPABLE,
  AutomationWebhooksBadRequestCodes.INVALID_SANDBOX_PROFILE_REFERENCE,
]);

export const AutomationWebhooksBadRequestResponseSchema = z
  .object({
    code: BadRequestCodeSchema,
    message: z.string().min(1),
  })
  .strict();

export const AutomationWebhooksNotFoundResponseSchema = z
  .object({
    code: z.literal(AutomationWebhooksNotFoundCodes.AUTOMATION_NOT_FOUND),
    message: z.string().min(1),
  })
  .strict();

export const AutomationWebhooksUnauthorizedResponseSchema = z
  .object({
    code: z.literal("UNAUTHORIZED"),
    message: z.string().min(1),
  })
  .strict();

export const AutomationWebhooksForbiddenResponseSchema = z
  .object({
    code: z.literal("ACTIVE_ORGANIZATION_REQUIRED"),
    message: z.string().min(1),
  })
  .strict();
