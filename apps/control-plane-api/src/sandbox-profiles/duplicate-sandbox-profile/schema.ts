import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { TriggerSchedulesBadRequestCodes } from "../../trigger-schedules/constants.js";
import { TriggerWebhooksBadRequestCodes } from "../../trigger-webhooks/constants.js";
import {
  SandboxProfilesBadRequestCodes,
  SandboxProfilesConflictCodes,
  SandboxProfilesNotFoundCodes,
} from "../errors.js";

export const badRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      SandboxProfilesBadRequestCodes.INVALID_REFRESH_SCHEDULE,
      TriggerSchedulesBadRequestCodes.INVALID_SCHEDULE,
      TriggerSchedulesBadRequestCodes.INVALID_PRIMARY_REPOSITORY,
      TriggerWebhooksBadRequestCodes.INVALID_WEBHOOK_SOURCE_REFERENCE,
      TriggerWebhooksBadRequestCodes.INVALID_WEBHOOK_TRIGGER_REQUIREMENTS,
      TriggerWebhooksBadRequestCodes.WEBHOOK_SOURCE_TARGET_NOT_WEBHOOK_CAPABLE,
      TriggerWebhooksBadRequestCodes.INVALID_SANDBOX_PROFILE_TRIGGER_REFERENCE,
      TriggerWebhooksBadRequestCodes.INVALID_PRIMARY_REPOSITORY,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const notFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND),
);

export const conflictResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    SandboxProfilesConflictCodes.INVALID_DUPLICATE_REFERENCE,
    SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_USABLE,
  ]),
);
