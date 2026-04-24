import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  integrationConnections,
  integrationTargets,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
} from "@mistle/db/control-plane";
import { desc, eq, inArray, sql } from "drizzle-orm";

import { toRepositoryOptions, type SandboxProfileRepositoryOption } from "./repository-options.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

export type LaunchableSandboxProfile = typeof sandboxProfiles.$inferSelect & {
  latestVersion: number;
  repositoryOptions: SandboxProfileRepositoryOption[];
};

export async function listLaunchableProfiles(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: {
    organizationId: string;
  },
): Promise<{
  items: LaunchableSandboxProfile[];
}> {
  const launchableVersionSql = sql<number>`(${sandboxProfiles.activeVersion})::int`;

  const candidates = await db
    .select({
      id: sandboxProfiles.id,
      organizationId: sandboxProfiles.organizationId,
      displayName: sandboxProfiles.displayName,
      activeVersion: sandboxProfiles.activeVersion,
      status: sandboxProfiles.status,
      createdAt: sandboxProfiles.createdAt,
      updatedAt: sandboxProfiles.updatedAt,
      latestVersion: launchableVersionSql,
    })
    .from(sandboxProfiles)
    .where(
      sql`${eq(sandboxProfiles.organizationId, input.organizationId)}
        and ${sandboxProfiles.activeVersion} is not null
        and exists (
        select 1
        from "control_plane"."sandbox_profile_version_integration_bindings" as spvib
        inner join ${integrationConnections} as icn
          on icn."id" = spvib."connection_id"
        inner join ${integrationTargets} as itg
          on itg."target_key" = icn."target_key"
        where spvib."sandbox_profile_id" = ${sandboxProfiles.id}
          and spvib."sandbox_profile_version" = ${launchableVersionSql}
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
          and spvib."sandbox_profile_version" = ${launchableVersionSql}
          and spvib."kind" = ${IntegrationBindingKinds.AGENT}
          and (
            icn."id" is null
            or icn."status" <> ${IntegrationConnectionStatuses.ACTIVE}
            or itg."target_key" is null
            or itg."enabled" = false
          )
      )`,
    )
    .orderBy(desc(sandboxProfiles.createdAt), desc(sandboxProfiles.id));

  const candidateIds = candidates.map((candidate) => candidate.id);
  const launchableVersionByProfileId = new Map(
    candidates.map((candidate) => [candidate.id, candidate.latestVersion]),
  );
  const gitBindings =
    candidateIds.length === 0
      ? []
      : await db
          .select({
            sandboxProfileId: sandboxProfileVersionIntegrationBindings.sandboxProfileId,
            sandboxProfileVersion: sandboxProfileVersionIntegrationBindings.sandboxProfileVersion,
            config: sandboxProfileVersionIntegrationBindings.config,
          })
          .from(sandboxProfileVersionIntegrationBindings)
          .innerJoin(
            integrationConnections,
            eq(integrationConnections.id, sandboxProfileVersionIntegrationBindings.connectionId),
          )
          .innerJoin(
            integrationTargets,
            eq(integrationTargets.targetKey, integrationConnections.targetKey),
          )
          .where(
            sql`${inArray(sandboxProfileVersionIntegrationBindings.sandboxProfileId, candidateIds)}
              and ${eq(sandboxProfileVersionIntegrationBindings.kind, IntegrationBindingKinds.GIT)}
              and ${eq(integrationConnections.organizationId, input.organizationId)}
              and ${eq(integrationConnections.status, IntegrationConnectionStatuses.ACTIVE)}
              and ${eq(integrationTargets.enabled, true)}`,
          )
          .orderBy(
            sandboxProfileVersionIntegrationBindings.sandboxProfileId,
            sandboxProfileVersionIntegrationBindings.sandboxProfileVersion,
            sandboxProfileVersionIntegrationBindings.id,
          );

  const gitBindingsByProfileId = new Map<string, Array<{ config: Record<string, unknown> }>>();
  for (const gitBinding of gitBindings) {
    if (
      launchableVersionByProfileId.get(gitBinding.sandboxProfileId) !==
      gitBinding.sandboxProfileVersion
    ) {
      continue;
    }

    const existingBindings = gitBindingsByProfileId.get(gitBinding.sandboxProfileId) ?? [];
    existingBindings.push({
      config: gitBinding.config,
    });
    gitBindingsByProfileId.set(gitBinding.sandboxProfileId, existingBindings);
  }

  return {
    items: candidates.map((candidate) => ({
      ...candidate,
      createdAt: new Date(candidate.createdAt).toISOString(),
      updatedAt: new Date(candidate.updatedAt).toISOString(),
      repositoryOptions: toRepositoryOptions({
        gitBindings: gitBindingsByProfileId.get(candidate.id) ?? [],
      }),
    })),
  };
}
