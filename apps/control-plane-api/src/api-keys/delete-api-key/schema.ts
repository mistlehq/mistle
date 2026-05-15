import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";

export const DeleteApiKeyNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal("NOT_FOUND"),
);
