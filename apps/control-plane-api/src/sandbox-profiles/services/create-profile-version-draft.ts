import {
  ControlPlaneConstraintIds,
  isControlPlaneUniqueViolation,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";

import {
  SandboxProfilesConflictCodes,
  SandboxProfilesConflictError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type CreateProfileVersionDraftInput = {
  organizationId: string;
  profileId: string;
};

type CreateProfileVersionDraftOutput = {
  sandboxProfileId: string;
  version: number;
  state: (typeof SandboxProfileVersionStates)[keyof typeof SandboxProfileVersionStates];
  isActive: boolean;
};

export async function createProfileVersionDraft(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: CreateProfileVersionDraftInput,
): Promise<CreateProfileVersionDraftOutput> {
  try {
    return await db.transaction(async (tx) => {
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
        .insert(sandboxProfileVersions)
        .values({
          sandboxProfileId: input.profileId,
          version: nextVersionNumber,
          state: SandboxProfileVersionStates.DRAFT,
          setupScript: latestVersion.setupScript,
        })
        .returning({
          sandboxProfileId: sandboxProfileVersions.sandboxProfileId,
          version: sandboxProfileVersions.version,
          state: sandboxProfileVersions.state,
        });

      if (createdDraftVersion === undefined) {
        throw new Error(
          `Failed to create draft version '${String(nextVersionNumber)}' for sandbox profile '${input.profileId}'.`,
        );
      }

      if (latestBindings.length > 0) {
        await tx.insert(sandboxProfileVersionIntegrationBindings).values(
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
        ...createdDraftVersion,
        isActive: false,
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
