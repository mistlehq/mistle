import { z } from "@hono/zod-openapi";

export const OrganizationBillingResponseSchema = z.union([
  z
    .object({
      available: z.literal(false),
    })
    .strict(),
  z
    .object({
      available: z.literal(true),
      organization: z
        .object({
          name: z.string().min(1),
          stripeCustomerId: z.string().min(1),
        })
        .strict(),
    })
    .strict(),
]);

export type OrganizationBillingResponse = z.infer<typeof OrganizationBillingResponseSchema>;
