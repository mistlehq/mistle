import { z } from "zod";

export const dashboardCapabilitiesResponseSchema = z
  .object({
    billing: z
      .object({
        stripe: z
          .object({
            enabled: z.literal(true),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type DashboardCapabilitiesResponse = z.infer<typeof dashboardCapabilitiesResponseSchema>;
