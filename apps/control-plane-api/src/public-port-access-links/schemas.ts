import { z } from "@hono/zod-openapi";

export const publicPortAccessLinkParamsSchema = z
  .object({
    slug: z
      .string()
      .min(12)
      .max(12)
      .regex(/^[0-9A-Za-z]+$/, {
        message: "`slug` must be a Port Access link slug.",
      }),
  })
  .strict();

export const publicPortAccessLinkRedeemResponseSchema = z
  .object({
    url: z.url(),
  })
  .strict();
