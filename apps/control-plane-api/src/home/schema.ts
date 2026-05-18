import { z } from "@hono/zod-openapi";

import { sandboxInstanceListItemSchema } from "../sandbox-instances/schemas.js";

export const homeSummaryResponseSchema = z
  .object({
    onboarding: z
      .object({
        hasIntegrations: z.boolean(),
        hasProfiles: z.boolean(),
        hasUsableProfiles: z.boolean(),
        hasStartedSession: z.boolean(),
        hasWebhookCapableIntegration: z.boolean(),
        hasTriggers: z.boolean(),
      })
      .strict(),
    recentSessions: z.array(sandboxInstanceListItemSchema),
  })
  .strict();

export type HomeSummaryResponse = z.infer<typeof homeSummaryResponseSchema>;
