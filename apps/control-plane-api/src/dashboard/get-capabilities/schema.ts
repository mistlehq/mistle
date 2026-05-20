import { z } from "zod";

import { ReleaseVersionHeaderName } from "../../release-version-header.js";

export const DashboardReleaseVersionHeaderName = ReleaseVersionHeaderName;

export const dashboardCapabilitiesResponseHeadersSchema = z
  .object({
    [DashboardReleaseVersionHeaderName]: z.string().min(1),
  })
  .strict();

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
