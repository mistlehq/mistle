import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  AutomationKinds,
  automations,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  integrationConnections,
  integrationTargets,
  sandboxProfiles,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { sql } from "drizzle-orm";
import { z } from "zod";

import type { HomeSummaryResponse } from "./schema.js";

const HomeSummaryRowSchema = z
  .object({
    hasIntegrations: z.boolean(),
    hasProfiles: z.boolean(),
    hasUsableProfiles: z.boolean(),
    hasAutomations: z.boolean(),
  })
  .strict();

export async function getHomeSummary(
  input: {
    db: ControlPlaneDatabase;
    dataPlaneClient: DataPlaneSandboxInstancesClient;
  },
  params: {
    organizationId: string;
  },
): Promise<HomeSummaryResponse> {
  const [summaryResult, startedSessionResult] = await Promise.all([
    input.db.execute(sql<{
      hasIntegrations: boolean;
      hasProfiles: boolean;
      hasUsableProfiles: boolean;
      hasAutomations: boolean;
    }>`select
        exists(
          select 1
          from ${integrationConnections} as icn
          where icn."organization_id" = ${params.organizationId}
        ) as "hasIntegrations",
        exists(
          select 1
          from ${sandboxProfiles} as sp
          where sp."organization_id" = ${params.organizationId}
        ) as "hasProfiles",
        exists(
          select 1
          from ${sandboxProfiles} as sp
          where sp."organization_id" = ${params.organizationId}
            and exists (
              select 1
              from "control_plane"."sandbox_profile_version_integration_bindings" as spvib
              inner join ${integrationConnections} as icn
                on icn."id" = spvib."connection_id"
              inner join ${integrationTargets} as itg
                on itg."target_key" = icn."target_key"
              where spvib."sandbox_profile_id" = sp."id"
                and spvib."sandbox_profile_version" = (
                  select max(spv.version)::int
                  from "control_plane"."sandbox_profile_versions" as spv
                  where spv."sandbox_profile_id" = sp."id"
                )
                and spvib."kind" = ${IntegrationBindingKinds.AGENT}
                and icn."organization_id" = ${params.organizationId}
                and icn."status" = ${IntegrationConnectionStatuses.ACTIVE}
                and itg."enabled" = true
            )
            and not exists (
              select 1
              from "control_plane"."sandbox_profile_version_integration_bindings" as spvib
              left join ${integrationConnections} as icn
                on icn."id" = spvib."connection_id"
               and icn."organization_id" = ${params.organizationId}
              left join ${integrationTargets} as itg
                on itg."target_key" = icn."target_key"
              where spvib."sandbox_profile_id" = sp."id"
                and spvib."sandbox_profile_version" = (
                  select max(spv.version)::int
                  from "control_plane"."sandbox_profile_versions" as spv
                  where spv."sandbox_profile_id" = sp."id"
                )
                and (
                  icn."id" is null
                  or icn."status" <> ${IntegrationConnectionStatuses.ACTIVE}
                  or itg."target_key" is null
                  or itg."enabled" = false
                )
            )
        ) as "hasUsableProfiles",
        exists(
          select 1
          from ${automations} as a
          where a."organization_id" = ${params.organizationId}
            and a."kind" = ${AutomationKinds.WEBHOOK}
        ) as "hasAutomations"`),
    input.dataPlaneClient.listSandboxInstances({
      organizationId: params.organizationId,
      limit: 1,
    }),
  ]);

  const summary = HomeSummaryRowSchema.parse(
    summaryResult.rows[0] ?? {
      hasIntegrations: false,
      hasProfiles: false,
      hasUsableProfiles: false,
      hasAutomations: false,
    },
  );

  return {
    onboarding: {
      hasIntegrations: summary.hasIntegrations,
      hasProfiles: summary.hasProfiles,
      hasUsableProfiles: summary.hasUsableProfiles,
      hasStartedSession: startedSessionResult.items.length > 0,
      hasAutomations: summary.hasAutomations,
    },
  };
}
