import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

export const badRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(z.string().min(1)),
  ValidationErrorResponseSchema,
]);

export const notFoundResponseSchema = createCodeMessageErrorSchema(z.string().min(1));
