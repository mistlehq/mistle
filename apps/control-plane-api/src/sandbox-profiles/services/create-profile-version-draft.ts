import {
  ControlPlaneConstraintIds,
  getControlPlaneDatabaseSchema,
  type SandboxProfileVersionAgentRuntimeId,
  isControlPlaneUniqueViolation,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";

import {
  SandboxProfilesConflictCodes,
  SandboxProfilesConflictError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import type { ProfileVersionRefreshScheduleSummary } from "./profile-version-refresh-schedule-summary.js";
import {
  mapProfileVersionRuntimeConfig,
  type SandboxProfileVersionResources,
} from "./profile-version-runtime-config.js";
import {
  mapProfileVersionSkillsConfig,
  type SandboxProfileVersionSkillsConfig,
} from "./profile-version-skills-config.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type CreateProfileVersionDraftInput = {
  organizationId: string;
  profileId: string;
};

type CreateProfileVersionDraftOutput = {
  sandboxProfileId: string;
  version: number;
  state: (typeof SandboxProfileVersionStates)[keyof typeof SandboxProfileVersionStates];
  publishedAt: string | null;
  agentRuntimeId: SandboxProfileVersionAgentRuntimeId;
  gitCommitSigningIntegrationConnectionId: string | null;
  mistleMcpEnabled: boolean;
  mistleMcpApiKeyId: string | null;
  sandboxProvider: string | null;
  sandboxConnectionId: string | null;
  maintenanceScript: string | null;
  sandboxResources: SandboxProfileVersionResources | null;
  skillsConfig: SandboxProfileVersionSkillsConfig | null;
  isActive: boolean;
  usable: boolean;
  refreshSchedule: ProfileVersionRefreshScheduleSummary | null;
  latestSnapshotJob: null;
};

export async function createProfileVersionDraft(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: CreateProfileVersionDraftInput,
): Promise<CreateProfileVersionDraftOutput> {
  try {
    return await db.transaction(async (tx) => {
      const tables = getControlPlaneDatabaseSchema(tx);

      const sandboxProfile = await tx.query.sandboxProfiles.findFirst({
        columns: {
          id: true,
        },
        where: (table, { and, eq }) =>
          and(eq(table.id, input.profileId), eq(table.organizationId, input.organizationId)),
      });

      if (sandboxProfile === undefined) {
        throw new SandboxProfilesNotFoundError(
          SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
          "Sandbox profile was not found.",
        );
      }

      const existingDraft = await tx.query.sandboxProfileVersions.findFirst({
        columns: {
          version: true,
        },
        where: (table, { and, eq }) =>
          and(
            eq(table.sandboxProfileId, input.profileId),
            eq(table.state, SandboxProfileVersionStates.DRAFT),
          ),
      });

      if (existingDraft !== undefined) {
        throw new SandboxProfilesConflictError(
          SandboxProfilesConflictCodes.DRAFT_ALREADY_EXISTS,
          `Sandbox profile '${input.profileId}' already has draft version '${String(existingDraft.version)}'.`,
        );
      }

      const latestVersion = await tx.query.sandboxProfileVersions.findFirst({
        columns: {
          version: true,
          setupScript: true,
          maintenanceScript: true,
          agentRuntimeId: true,
          gitCommitSigningIntegrationConnectionId: true,
          mistleMcpEnabled: true,
          mistleMcpApiKeyId: true,
          sandboxProvider: true,
          sandboxConnectionId: true,
          sandboxVcpuCount: true,
          sandboxMemoryMb: true,
          sandboxStorageMb: true,
          skillsConfig: true,
        },
        where: (table, { eq }) => eq(table.sandboxProfileId, input.profileId),
        orderBy: (table, { desc }) => [desc(table.version)],
      });

      if (latestVersion === undefined) {
        throw new Error(
          `Sandbox profile '${input.profileId}' has no versions to clone when creating a draft.`,
        );
      }

      const latestBindings = await tx.query.sandboxProfileVersionIntegrationBindings.findMany({
        columns: {
          connectionId: true,
          kind: true,
          config: true,
        },
        where: (table, { and, eq }) =>
          and(
            eq(table.sandboxProfileId, input.profileId),
            eq(table.sandboxProfileVersion, latestVersion.version),
          ),
        orderBy: (table, { asc }) => [asc(table.id)],
      });

      const nextVersionNumber = latestVersion.version + 1;

      const [createdDraftVersion] = await tx
        .insert(tables.sandboxProfileVersions)
        .values({
          sandboxProfileId: input.profileId,
          version: nextVersionNumber,
          state: SandboxProfileVersionStates.DRAFT,
          setupScript: latestVersion.setupScript,
          maintenanceScript: latestVersion.maintenanceScript,
          agentRuntimeId: latestVersion.agentRuntimeId,
          gitCommitSigningIntegrationConnectionId:
            latestVersion.gitCommitSigningIntegrationConnectionId,
          mistleMcpEnabled: latestVersion.mistleMcpEnabled,
          mistleMcpApiKeyId: latestVersion.mistleMcpApiKeyId,
          sandboxProvider: latestVersion.sandboxProvider,
          sandboxConnectionId: latestVersion.sandboxConnectionId,
          sandboxVcpuCount: latestVersion.sandboxVcpuCount,
          sandboxMemoryMb: latestVersion.sandboxMemoryMb,
          sandboxStorageMb: latestVersion.sandboxStorageMb,
          skillsConfig: latestVersion.skillsConfig,
        })
        .returning({
          sandboxProfileId: tables.sandboxProfileVersions.sandboxProfileId,
          version: tables.sandboxProfileVersions.version,
          state: tables.sandboxProfileVersions.state,
          publishedAt: tables.sandboxProfileVersions.publishedAt,
          agentRuntimeId: tables.sandboxProfileVersions.agentRuntimeId,
          gitCommitSigningIntegrationConnectionId:
            tables.sandboxProfileVersions.gitCommitSigningIntegrationConnectionId,
          mistleMcpEnabled: tables.sandboxProfileVersions.mistleMcpEnabled,
          mistleMcpApiKeyId: tables.sandboxProfileVersions.mistleMcpApiKeyId,
          sandboxProvider: tables.sandboxProfileVersions.sandboxProvider,
          sandboxConnectionId: tables.sandboxProfileVersions.sandboxConnectionId,
          sandboxVcpuCount: tables.sandboxProfileVersions.sandboxVcpuCount,
          sandboxMemoryMb: tables.sandboxProfileVersions.sandboxMemoryMb,
          sandboxStorageMb: tables.sandboxProfileVersions.sandboxStorageMb,
          skillsConfig: tables.sandboxProfileVersions.skillsConfig,
        });

      if (createdDraftVersion === undefined) {
        throw new Error(
          `Failed to create draft version '${String(nextVersionNumber)}' for sandbox profile '${input.profileId}'.`,
        );
      }

      if (latestBindings.length > 0) {
        await tx.insert(tables.sandboxProfileVersionIntegrationBindings).values(
          latestBindings.map((binding) => ({
            sandboxProfileId: input.profileId,
            sandboxProfileVersion: nextVersionNumber,
            connectionId: binding.connectionId,
            kind: binding.kind,
            config: binding.config,
          })),
        );
      }

      return {
        sandboxProfileId: createdDraftVersion.sandboxProfileId,
        version: createdDraftVersion.version,
        state: createdDraftVersion.state,
        publishedAt: createdDraftVersion.publishedAt,
        agentRuntimeId: createdDraftVersion.agentRuntimeId,
        gitCommitSigningIntegrationConnectionId:
          createdDraftVersion.gitCommitSigningIntegrationConnectionId,
        mistleMcpEnabled: createdDraftVersion.mistleMcpEnabled,
        mistleMcpApiKeyId: createdDraftVersion.mistleMcpApiKeyId,
        ...mapProfileVersionRuntimeConfig(createdDraftVersion),
        skillsConfig: mapProfileVersionSkillsConfig(createdDraftVersion.skillsConfig),
        maintenanceScript: latestVersion.maintenanceScript,
        isActive: false,
        usable: false,
        refreshSchedule: null,
        latestSnapshotJob: null,
      };
    });
  } catch (error) {
    if (
      isControlPlaneUniqueViolation(
        error,
        ControlPlaneConstraintIds.SANDBOX_PROFILE_VERSIONS_ONE_DRAFT_PER_PROFILE,
      )
    ) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.DRAFT_ALREADY_EXISTS,
        `Sandbox profile '${input.profileId}' already has a draft version.`,
      );
    }

    throw error;
  }
}
