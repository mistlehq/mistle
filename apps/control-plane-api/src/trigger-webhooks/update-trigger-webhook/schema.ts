import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { TriggerWebhooksBadRequestCodes } from "../constants.js";

export const UpdateTriggerWebhookBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    integrationWebhookSourceId: z.string().min(1).optional(),
    eventTypes: z.array(z.string().min(1)).min(1).nullable().optional(),
    payloadFilter: z.record(z.string(), z.unknown()).nullable().optional(),
    inputTemplate: z.string().min(1).optional(),
    instructions: z.string().min(1).nullable().optional(),
    conversationKeyTemplate: z.string().min(1).optional(),
    idempotencyKeyTemplate: z.string().min(1).nullable().optional(),
    target: z
      .object({
        sandboxProfileId: z.string().min(1).optional(),
        sandboxProfileVersion: z.number().int().min(1).optional(),
        primaryRepositoryId: z.string().min(1).nullable().optional(),
      })
      .strict()
      .refine(
        (value) =>
          value.sandboxProfileId !== undefined ||
          value.sandboxProfileVersion !== undefined ||
          value.primaryRepositoryId !== undefined,
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
      value.integrationWebhookSourceId !== undefined ||
      value.eventTypes !== undefined ||
      value.payloadFilter !== undefined ||
      value.inputTemplate !== undefined ||
      value.instructions !== undefined ||
      value.conversationKeyTemplate !== undefined ||
      value.idempotencyKeyTemplate !== undefined ||
      value.target !== undefined,
    {
      message: "At least one field must be provided.",
    },
  );

export const UpdateTriggerWebhookBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      TriggerWebhooksBadRequestCodes.INVALID_WEBHOOK_SOURCE_REFERENCE,
      TriggerWebhooksBadRequestCodes.INVALID_WEBHOOK_TRIGGER_REQUIREMENTS,
      TriggerWebhooksBadRequestCodes.WEBHOOK_SOURCE_TARGET_NOT_WEBHOOK_CAPABLE,
      TriggerWebhooksBadRequestCodes.INVALID_SANDBOX_PROFILE_REFERENCE,
      TriggerWebhooksBadRequestCodes.INVALID_SANDBOX_PROFILE_TRIGGER_REFERENCE,
      TriggerWebhooksBadRequestCodes.INVALID_PRIMARY_REPOSITORY,
    ]),
  ),
  ValidationErrorResponseSchema,
]);
