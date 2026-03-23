import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";

export const RefreshIntegrationConnectionResourcesParamsSchema = z
  .object({
    connectionId: z.string().min(1),
    kind: z.string().min(1),
  })
  .strict();

export const RefreshIntegrationConnectionResourcesResponseSchema = z
  .object({
    connectionId: z.string().min(1),
    familyId: z.string().min(1),
    kind: z.string().min(1),
    syncState: z.literal("syncing"),
  })
  .strict();

export const RefreshIntegrationConnectionResourcesBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([IntegrationConnectionsBadRequestCodes.RESOURCE_KIND_NOT_SUPPORTED]),
  ),
  ValidationErrorResponseSchema,
]);

export const RefreshIntegrationConnectionResourcesNotFoundResponseSchema =
  createCodeMessageErrorSchema(z.literal(IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND));
