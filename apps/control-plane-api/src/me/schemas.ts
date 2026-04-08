import { z } from "@hono/zod-openapi";

import { singletonImageMetadataResponseSchema } from "../lib/singleton-image-metadata.js";

const multipartFileSchema = z
  .unknown()
  .openapi({
    type: "string",
    format: "binary",
  })
  .refine((value) => value instanceof File, {
    message: "Expected file upload.",
  });

export const profileImageUploadFormSchema = z
  .object({
    file: multipartFileSchema,
  })
  .strict();

export const profileImageMetadataResponseSchema = singletonImageMetadataResponseSchema;
