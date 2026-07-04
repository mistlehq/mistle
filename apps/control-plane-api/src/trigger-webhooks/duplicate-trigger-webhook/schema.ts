import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { TriggerWebhooksBadRequestCodes } from "../constants.js";

export const DuplicateTriggerWebhookBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      TriggerWebhooksBadRequestCodes.INVALID_WEBHOOK_SOURCE_REFERENCE,
      TriggerWebhooksBadRequestCodes.INVALID_WEBHOOK_TRIGGER_REQUIREMENTS,
      TriggerWebhooksBadRequestCodes.WEBHOOK_SOURCE_TARGET_NOT_WEBHOOK_CAPABLE,
      TriggerWebhooksBadRequestCodes.INVALID_SANDBOX_PROFILE_REFERENCE,
      TriggerWebhooksBadRequestCodes.INVALID_SANDBOX_PROFILE_TRIGGER_REFERENCE,
      TriggerWebhooksBadRequestCodes.INVALID_PRIMARY_REPOSITORY,
      TriggerWebhooksBadRequestCodes.INVALID_WEBHOOK_TRIGGER_TEMPLATE_REFERENCES,
    ]),
  ),
  ValidationErrorResponseSchema,
]);
