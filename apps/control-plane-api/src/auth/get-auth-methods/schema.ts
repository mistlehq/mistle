import { z } from "@hono/zod-openapi";

export const authMethodsResponseSchema = z
  .object({
    methods: z
      .object({
        emailOtp: z.literal(true),
        google: z.boolean(),
      })
      .strict(),
    organization: z
      .object({
        selfServiceCreationEnabled: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type AuthMethodsResponse = z.infer<typeof authMethodsResponseSchema>;
