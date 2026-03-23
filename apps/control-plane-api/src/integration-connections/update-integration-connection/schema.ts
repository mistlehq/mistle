import { z } from "@hono/zod-openapi";
import { ValidationErrorResponseSchema } from "@mistle/http/errors.js";

export const UpdateIntegrationConnectionParamsSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export const UpdateIntegrationConnectionBodySchema = z
  .object({
    displayName: z.string().min(1),
  })
  .strict();

export const UpdateIntegrationConnectionBadRequestResponseSchema = ValidationErrorResponseSchema;
