import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";

export const RepairIntegrationConnectionParamsSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export const RepairIntegrationConnectionBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.CONNECTION_REPAIR_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.CONNECTION_REPAIR_FAILED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const RepairIntegrationConnectionNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.enum([IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND]),
);
