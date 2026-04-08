import { z } from "@hono/zod-openapi";

export const singletonImageMetadataResponseSchema = z
  .object({
    hasImage: z.boolean(),
    imageVersion: z.string().min(1).nullable(),
  })
  .strict();

export type SingletonImageMetadata = z.infer<typeof singletonImageMetadataResponseSchema>;

export function createSingletonImageMetadataResponse(
  imageObjectKey: string | null,
): SingletonImageMetadata {
  return {
    hasImage: imageObjectKey !== null,
    imageVersion: imageObjectKey,
  };
}
