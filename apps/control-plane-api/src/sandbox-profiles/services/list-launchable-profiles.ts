import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  integrationConnections,
  integrationTargets,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
} from "@mistle/db/control-plane";
import { DefaultSandboxWorkspaceDir } from "@mistle/integrations-core";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { CreateSandboxProfilesServiceInput } from "./types.js";

const GitBindingConfigSchema = z.looseObject({
  repositories: z.array(z.string().min(1)),
});

export type LaunchableSandboxProfileRepositoryOption = {
  id: string;
  label: string;
  path: string;
};

export type LaunchableSandboxProfile = typeof sandboxProfiles.$inferSelect & {
  latestVersion: number;
  repositoryOptions: LaunchableSandboxProfileRepositoryOption[];
};

function toRepositoryWorkspacePath(repository: string): string {
  return `${DefaultSandboxWorkspaceDir}/${repository}`;
}

function toRepositoryOptions(input: {
  gitBindings: ReadonlyArray<{
    config: Record<string, unknown>;
  }>;
}): LaunchableSandboxProfileRepositoryOption[] {
  const repositoryOptionsById = new Map<string, LaunchableSandboxProfileRepositoryOption>();

  for (const gitBinding of input.gitBindings) {
    const parsedConfig = GitBindingConfigSchema.parse(gitBinding.config);

    for (const repository of parsedConfig.repositories) {
      repositoryOptionsById.set(repository, {
        id: repository,
        label: repository,
        path: toRepositoryWorkspacePath(repository),
      });
    }
  }

  return [...repositoryOptionsById.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

export async function listLaunchableProfiles(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: {
    organizationId: string;
  },
): Promise<{
  items: LaunchableSandboxProfile[];
}> {
  const latestVersionSql = sql<number>`(
    select max(spv.version)::int
    from "control_plane"."sandbox_profile_versions" as spv
    where spv."sandbox_profile_id" = ${sandboxProfiles.id}
  )`;

  const candidates = await db
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
  const latestVersionByProfileId = new Map(
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
      latestVersionByProfileId.get(gitBinding.sandboxProfileId) !== gitBinding.sandboxProfileVersion
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
