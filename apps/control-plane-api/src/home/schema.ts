import { z } from "@hono/zod-openapi";

export const homeSummaryResponseSchema = z
  .object({
    onboarding: z
      .object({
        hasIntegrations: z.boolean(),
        hasProfiles: z.boolean(),
        hasUsableProfiles: z.boolean(),
        hasStartedSession: z.boolean(),
        hasWebhookCapableIntegration: z.boolean(),
        hasAutomations: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type HomeSummaryResponse = z.infer<typeof homeSummaryResponseSchema>;
