import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";

export const RefreshAllIntegrationConnectionResourcesParamsSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export const RefreshAllIntegrationConnectionResourcesResponseSchema = z
  .object({
    connectionId: z.string().min(1),
    familyId: z.string().min(1),
    resources: z.array(
      z
        .object({
          kind: z.string().min(1),
          syncState: z.literal("syncing"),
        })
        .strict(),
    ),
  })
  .strict();

export const RefreshAllIntegrationConnectionResourcesBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([IntegrationConnectionsBadRequestCodes.RESOURCE_KIND_NOT_SUPPORTED]),
  ),
  ValidationErrorResponseSchema,
]);

export const RefreshAllIntegrationConnectionResourcesNotFoundResponseSchema =
  createCodeMessageErrorSchema(z.literal(IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND));
