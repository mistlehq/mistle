import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { AutomationSchedulesBadRequestCodes } from "../constants.js";

export const CreateAutomationScheduleBodySchema = z
  .object({
    name: z.string().min(1),
    enabled: z.boolean().optional(),
    schedule: z
      .object({
        name: z.string().min(1).optional(),
        cronExpression: z.string().min(1),
        timezone: z.string().min(1),
      })
      .strict(),
    inputTemplate: z.string().min(1),
    conversationKeyTemplate: z.string().min(1).optional(),
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

const CreateAutomationScheduleBadRequestCodeSchema = z.enum([
  AutomationSchedulesBadRequestCodes.INVALID_SCHEDULE,
  AutomationSchedulesBadRequestCodes.INVALID_SANDBOX_PROFILE_REFERENCE,
  AutomationSchedulesBadRequestCodes.INVALID_SANDBOX_PROFILE_VERSION_REFERENCE,
  AutomationSchedulesBadRequestCodes.INVALID_PRIMARY_REPOSITORY,
]);

export const CreateAutomationScheduleBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(CreateAutomationScheduleBadRequestCodeSchema),
  ValidationErrorResponseSchema,
]);
