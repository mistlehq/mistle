import { z } from "@hono/zod-openapi";

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

export const profileImageMetadataResponseSchema = z
  .object({
    hasImage: z.boolean(),
    imageVersion: z.string().min(1).nullable(),
  })
  .strict();
