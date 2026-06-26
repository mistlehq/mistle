import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { TriggerSchedulesBadRequestCodes } from "../constants.js";

const RecurringScheduleInputSchema = z
  .object({
    kind: z.literal("recurring").optional(),
    name: z.string().min(1).optional(),
    cronExpression: z.string().min(1),
    timezone: z.string().min(1),
  })
  .strict();

const OneOffScheduleInputSchema = z
  .object({
    kind: z.literal("one_off"),
    name: z.string().min(1).optional(),
    startAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const CreateTriggerScheduleBodySchema = z
  .object({
    name: z.string().min(1),
    enabled: z.boolean().optional(),
    schedule: z.union([OneOffScheduleInputSchema, RecurringScheduleInputSchema]),
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

const CreateTriggerScheduleBadRequestCodeSchema = z.enum([
  TriggerSchedulesBadRequestCodes.INVALID_SCHEDULE,
  TriggerSchedulesBadRequestCodes.INVALID_SANDBOX_PROFILE_REFERENCE,
  TriggerSchedulesBadRequestCodes.INVALID_SANDBOX_PROFILE_VERSION_REFERENCE,
  TriggerSchedulesBadRequestCodes.INVALID_PRIMARY_REPOSITORY,
]);

export const CreateTriggerScheduleBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(CreateTriggerScheduleBadRequestCodeSchema),
  ValidationErrorResponseSchema,
]);
