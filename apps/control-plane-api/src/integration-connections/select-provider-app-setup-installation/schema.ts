import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";

export const SelectProviderAppSetupInstallationParamsSchema = z
  .object({
    connectionId: z.string().min(1),
    routeSegment: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  })
  .strict();

export const SelectProviderAppSetupInstallationBodySchema = z
  .object({
    installationId: z.string().min(1),
  })
  .strict();

export const SelectedProviderAppSetupInstallationResponseSchema = z
  .object({
    connectionId: z.string().min(1),
    targetKey: z.string().min(1),
    completionRedirect: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("connection-detail"),
          notice: z.string().min(1).optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("setup-route"),
          query: z.record(z.string(), z.string()).optional(),
        })
        .strict(),
    ]),
  })
  .strict();

export const SelectProviderAppSetupInstallationBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_METHOD_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.PROVIDER_APP_SETUP_CONNECTION_METHOD_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const SelectProviderAppSetupInstallationNotFoundResponseSchema =
  createCodeMessageErrorSchema(z.literal(IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND));
