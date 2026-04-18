import { z } from "@hono/zod-openapi";
import { ValidationErrorResponseSchema } from "@mistle/http/errors.js";

export const DeleteLinkedAccountParamsSchema = z
  .object({
    providerFamily: z.string().min(1),
  })
  .strict();

export const DeleteLinkedAccountValidationErrorResponseSchema = ValidationErrorResponseSchema;
