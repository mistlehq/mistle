import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  integrationConnections,
  integrationTargets,
  sandboxProfiles,
} from "@mistle/db/control-plane";
import { desc, eq, sql } from "drizzle-orm";

import type { CreateSandboxProfilesServiceInput } from "./types.js";

export type LaunchableSandboxProfile = typeof sandboxProfiles.$inferSelect & {
  latestVersion: number;
};

export async function listLaunchableProfiles(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: {
    organizationId: string;
  },
): Promise<{
  items: LaunchableSandboxProfile[];
}> {
  // This endpoint is a fast structural eligibility filter for the sessions picker.
  // It intentionally does not try to mirror every start-time runtime-plan validation,
  // which still runs when a session is actually started.
  const latestVersionSql = sql<number>`(
    select max(spv.version)::int
    from "control_plane"."sandbox_profile_versions" as spv
    where spv."sandbox_profile_id" = ${sandboxProfiles.id}
  )`;

  const items = await db
    .select({
      id: sandboxProfiles.id,
      organizationId: sandboxProfiles.organizationId,
      displayName: sandboxProfiles.displayName,
      status: sandboxProfiles.status,
      createdAt: sandboxProfiles.createdAt,
      updatedAt: sandboxProfiles.updatedAt,
      latestVersion: latestVersionSql,
    })
    .from(sandboxProfiles)
    .where(
      sql`${eq(sandboxProfiles.organizationId, input.organizationId)} and exists (
        select 1
        from "control_plane"."sandbox_profile_version_integration_bindings" as spvib
        inner join ${integrationConnections} as icn
          on icn."id" = spvib."connection_id"
        inner join ${integrationTargets} as itg
          on itg."target_key" = icn."target_key"
        where spvib."sandbox_profile_id" = ${sandboxProfiles.id}
          and spvib."sandbox_profile_version" = ${latestVersionSql}
          and spvib."kind" = ${IntegrationBindingKinds.AGENT}
          and icn."organization_id" = ${input.organizationId}
          and icn."status" = ${IntegrationConnectionStatuses.ACTIVE}
          and itg."enabled" = true
      ) and not exists (
        select 1
        from "control_plane"."sandbox_profile_version_integration_bindings" as spvib
        left join ${integrationConnections} as icn
          on icn."id" = spvib."connection_id"
         and icn."organization_id" = ${input.organizationId}
        left join ${integrationTargets} as itg
          on itg."target_key" = icn."target_key"
        where spvib."sandbox_profile_id" = ${sandboxProfiles.id}
          and spvib."sandbox_profile_version" = ${latestVersionSql}
          and (
            icn."id" is null
            or icn."status" <> ${IntegrationConnectionStatuses.ACTIVE}
            or itg."target_key" is null
            or itg."enabled" = false
          )
      )`,
    )
    .orderBy(desc(sandboxProfiles.createdAt), desc(sandboxProfiles.id));

  return {
    items: items.map((item) => ({
      ...item,
      createdAt: new Date(item.createdAt).toISOString(),
      updatedAt: new Date(item.updatedAt).toISOString(),
    })),
  };
}
