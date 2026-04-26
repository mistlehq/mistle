import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../../constants.js";

export const CreateSlackAppDraftConnectionParamsSchema = z
  .object({
    targetKey: z.string().min(1),
  })
  .strict();

export const CreateSlackAppDraftConnectionBodySchema = z
  .object({
    displayName: z.string().trim().min(1),
  })
  .strict();

export const CreateSlackAppDraftConnectionBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
      IntegrationConnectionsBadRequestCodes.SLACK_APP_MANIFEST_NOT_SUPPORTED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const CreateSlackAppDraftConnectionNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND),
);
