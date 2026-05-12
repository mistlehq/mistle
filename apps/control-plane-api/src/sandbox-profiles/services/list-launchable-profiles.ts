import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  type SandboxProfile,
  SandboxProfileVersionStates,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { desc, eq, inArray, sql } from "drizzle-orm";

import { toRepositoryOptions, type SandboxProfileRepositoryOption } from "./repository-options.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

export type LaunchableSandboxProfile = SandboxProfile & {
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
  const tables = getControlPlaneDatabaseSchema(db);

  const launchableVersionSql = sql<number>`(${tables.sandboxProfiles.activeVersion})::int`;

  const candidates = await db
    .select({
      id: tables.sandboxProfiles.id,
      organizationId: tables.sandboxProfiles.organizationId,
      displayName: tables.sandboxProfiles.displayName,
      activeVersion: tables.sandboxProfiles.activeVersion,
      status: tables.sandboxProfiles.status,
      createdAt: tables.sandboxProfiles.createdAt,
      updatedAt: tables.sandboxProfiles.updatedAt,
      latestVersion: launchableVersionSql,
    })
    .from(tables.sandboxProfiles)
    .where(
      sql`${eq(tables.sandboxProfiles.organizationId, input.organizationId)}
        and ${tables.sandboxProfiles.activeVersion} is not null
        and exists (
          select 1
          from ${tables.sandboxProfileVersions}
          where ${tables.sandboxProfileVersions.sandboxProfileId} = ${tables.sandboxProfiles.id}
            and ${tables.sandboxProfileVersions.version} = ${tables.sandboxProfiles.activeVersion}
            and ${tables.sandboxProfileVersions.state} = ${SandboxProfileVersionStates.PUBLISHED}
        )`,
    )
    .orderBy(desc(tables.sandboxProfiles.createdAt), desc(tables.sandboxProfiles.id));

  const candidateIds = candidates.map((candidate) => candidate.id);
  const launchableVersionByProfileId = new Map(
    candidates.map((candidate) => [candidate.id, candidate.latestVersion]),
  );
  const gitBindings =
    candidateIds.length === 0
      ? []
      : await db
          .select({
            sandboxProfileId: tables.sandboxProfileVersionIntegrationBindings.sandboxProfileId,
            sandboxProfileVersion:
              tables.sandboxProfileVersionIntegrationBindings.sandboxProfileVersion,
            config: tables.sandboxProfileVersionIntegrationBindings.config,
          })
          .from(tables.sandboxProfileVersionIntegrationBindings)
          .innerJoin(
            tables.integrationConnections,
            eq(
              tables.integrationConnections.id,
              tables.sandboxProfileVersionIntegrationBindings.connectionId,
            ),
          )
          .innerJoin(
            tables.integrationTargets,
            eq(tables.integrationTargets.targetKey, tables.integrationConnections.targetKey),
          )
          .where(
            sql`${inArray(tables.sandboxProfileVersionIntegrationBindings.sandboxProfileId, candidateIds)}
              and ${eq(tables.sandboxProfileVersionIntegrationBindings.kind, IntegrationBindingKinds.GIT)}
              and ${eq(tables.integrationConnections.organizationId, input.organizationId)}
              and ${eq(tables.integrationConnections.status, IntegrationConnectionStatuses.ACTIVE)}
              and ${eq(tables.integrationTargets.enabled, true)}`,
          )
          .orderBy(
            tables.sandboxProfileVersionIntegrationBindings.sandboxProfileId,
            tables.sandboxProfileVersionIntegrationBindings.sandboxProfileVersion,
            tables.sandboxProfileVersionIntegrationBindings.id,
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
