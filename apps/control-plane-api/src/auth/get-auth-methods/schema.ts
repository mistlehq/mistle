import { z } from "@hono/zod-openapi";

export const authMethodsResponseSchema = z
  .object({
    methods: z
      .object({
        emailOtp: z.literal(true),
        google: z.boolean(),
      })
      .strict(),
    allowSignups: z.boolean(),
  })
  .strict();

export type AuthMethodsResponse = z.infer<typeof authMethodsResponseSchema>;
