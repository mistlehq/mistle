import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  integrationConnections,
  integrationTargets,
  sandboxProfiles,
} from "@mistle/db/control-plane";
import { desc, eq, sql } from "drizzle-orm";

import { compileProfileVersionRuntimePlan } from "../compile-profile-version-runtime-plan.js";
import { SandboxProfilesCompileError, SandboxProfilesNotFoundError } from "../errors.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

const WorkspaceRootPrefix = "/root/";

export type LaunchableSandboxProfileRepositoryOption = {
  id: string;
  label: string;
  path: string;
};

export type LaunchableSandboxProfile = typeof sandboxProfiles.$inferSelect & {
  latestVersion: number;
  repositoryOptions: LaunchableSandboxProfileRepositoryOption[];
};

function toRepositoryOptionLabel(path: string): string {
  if (path.startsWith(WorkspaceRootPrefix)) {
    return path.slice(WorkspaceRootPrefix.length);
  }

  return path;
}

function toRepositoryOptions(input: {
  workspaceSources: ReadonlyArray<{
    resourceKind: string;
    path: string;
  }>;
}): LaunchableSandboxProfileRepositoryOption[] {
  const repositoryOptionsByPath = new Map<string, LaunchableSandboxProfileRepositoryOption>();

  for (const workspaceSource of input.workspaceSources) {
    if (workspaceSource.resourceKind !== "repository") {
      continue;
    }

    repositoryOptionsByPath.set(workspaceSource.path, {
      id: workspaceSource.path,
      label: toRepositoryOptionLabel(workspaceSource.path),
      path: workspaceSource.path,
    });
  }

  return [...repositoryOptionsByPath.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

export async function listLaunchableProfiles(
  { db, integrationsConfig }: Pick<CreateSandboxProfilesServiceInput, "db" | "integrationsConfig">,
  input: {
    organizationId: string;
    imageRef: string;
  },
): Promise<{
  items: LaunchableSandboxProfile[];
}> {
  // This endpoint feeds the dashboard session picker. Compile each candidate so the
  // response reflects the actual repository workspace sources the sandbox would use.
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

  const compiledCandidates = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const runtimePlan = await compileProfileVersionRuntimePlan(
          {
            db,
            integrationsConfig,
          },
          {
            organizationId: input.organizationId,
            profileId: candidate.id,
            profileVersion: candidate.latestVersion,
            image: {
              source: "base",
              imageRef: input.imageRef,
            },
          },
        );

        return {
          ...candidate,
          createdAt: new Date(candidate.createdAt).toISOString(),
          updatedAt: new Date(candidate.updatedAt).toISOString(),
          repositoryOptions: toRepositoryOptions({
            workspaceSources: runtimePlan.workspaceSources,
          }),
        } satisfies LaunchableSandboxProfile;
      } catch (error) {
        if (
          error instanceof SandboxProfilesCompileError ||
          error instanceof SandboxProfilesNotFoundError
        ) {
          return null;
        }

        throw error;
      }
    }),
  );

  return {
    items: compiledCandidates.filter((candidate) => candidate !== null),
  };
}
