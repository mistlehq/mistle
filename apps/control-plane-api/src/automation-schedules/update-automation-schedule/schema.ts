import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { AutomationSchedulesBadRequestCodes } from "../constants.js";

export const UpdateAutomationScheduleBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    schedule: z
      .object({
        name: z.string().min(1).optional(),
        cronExpression: z.string().min(1).optional(),
        timezone: z.string().min(1).optional(),
      })
      .strict()
      .refine(
        (value) =>
          value.name !== undefined ||
          value.cronExpression !== undefined ||
          value.timezone !== undefined,
        {
          message: "At least one schedule field must be provided.",
        },
      )
      .optional(),
    inputTemplate: z.string().min(1).optional(),
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
      value.schedule !== undefined ||
      value.inputTemplate !== undefined ||
      value.conversationKeyTemplate !== undefined ||
      value.idempotencyKeyTemplate !== undefined ||
      value.target !== undefined,
    {
      message: "At least one field must be provided.",
    },
  );

export const UpdateAutomationScheduleBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      AutomationSchedulesBadRequestCodes.INVALID_SCHEDULE,
      AutomationSchedulesBadRequestCodes.INVALID_SANDBOX_PROFILE_REFERENCE,
      AutomationSchedulesBadRequestCodes.INVALID_SANDBOX_PROFILE_VERSION_REFERENCE,
      AutomationSchedulesBadRequestCodes.INVALID_PRIMARY_REPOSITORY,
    ]),
  ),
  ValidationErrorResponseSchema,
]);
