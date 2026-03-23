import { z } from "@hono/zod-openapi";
import { ValidationErrorResponseSchema } from "@mistle/http/errors.js";

export const InternalSandboxRuntimeErrorResponseSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export const InternalSandboxRuntimeBadRequestResponseSchema = z.union([
  InternalSandboxRuntimeErrorResponseSchema,
  ValidationErrorResponseSchema,
]);
