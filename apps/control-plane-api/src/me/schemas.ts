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

export const profileImageResponseSchema = z
  .object({
    imageUrl: z.url(),
  })
  .strict();

export const profileImageStateResponseSchema = z
  .object({
    imageUrl: z.url().nullable(),
  })
  .strict();
