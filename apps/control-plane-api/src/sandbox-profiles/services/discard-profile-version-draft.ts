import {
  getControlPlaneDatabaseSchema,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { and, eq } from "drizzle-orm";

import {
  SandboxProfilesConflictCodes,
  SandboxProfilesConflictError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import { softDeleteSnapshotRefreshSchedulesForProfileVersion } from "./delete-profile-version-refresh-schedule.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type DiscardProfileVersionDraftInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
};

type DiscardProfileVersionDraftOutput = {
  discardedVersion: number;
  hasDraft: boolean;
};

export async function discardProfileVersionDraft(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: DiscardProfileVersionDraftInput,
): Promise<DiscardProfileVersionDraftOutput> {
  const tables = getControlPlaneDatabaseSchema(db);

  return db.transaction(async (tx) => {
    const sandboxProfile = await tx.query.sandboxProfiles.findFirst({
      columns: {
        activeVersion: true,
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

    if (sandboxProfile.activeVersion === null) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.DRAFT_ONLY_PROFILE_VERSION_CANNOT_BE_DISCARDED,
        "Draft-only sandbox profiles cannot discard their only version. Delete the profile instead.",
      );
    }

    if (sandboxProfile.activeVersion === input.profileVersion) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.PROFILE_VERSION_ACTIVE,
        `Sandbox profile version '${String(input.profileVersion)}' is active and cannot be discarded.`,
      );
    }

    const [lockedVersion] = await tx
      .select({
        sandboxProfileId: tables.sandboxProfileVersions.sandboxProfileId,
        version: tables.sandboxProfileVersions.version,
        state: tables.sandboxProfileVersions.state,
      })
      .from(tables.sandboxProfileVersions)
      .where(
        and(
          eq(tables.sandboxProfileVersions.sandboxProfileId, input.profileId),
          eq(tables.sandboxProfileVersions.version, input.profileVersion),
        ),
      )
      .limit(1)
      .for("update");

    if (lockedVersion === undefined) {
      throw new SandboxProfilesNotFoundError(
        SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
        "Sandbox profile version was not found.",
      );
    }

    if (lockedVersion.state !== SandboxProfileVersionStates.DRAFT) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_DRAFT,
        `Sandbox profile version '${String(input.profileVersion)}' is not a draft.`,
      );
    }

    await softDeleteSnapshotRefreshSchedulesForProfileVersion(tx, {
      tables,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
    });

    const [deletedVersion] = await tx
      .delete(tables.sandboxProfileVersions)
      .where(
        and(
          eq(tables.sandboxProfileVersions.sandboxProfileId, input.profileId),
          eq(tables.sandboxProfileVersions.version, input.profileVersion),
          eq(tables.sandboxProfileVersions.state, SandboxProfileVersionStates.DRAFT),
        ),
      )
      .returning({
        version: tables.sandboxProfileVersions.version,
      });

    if (deletedVersion === undefined) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_DRAFT,
        `Sandbox profile version '${String(input.profileVersion)}' is not a draft.`,
      );
    }

    const remainingDraft = await tx.query.sandboxProfileVersions.findFirst({
      columns: {
        version: true,
      },
      where: (table, { and, eq }) =>
        and(
          eq(table.sandboxProfileId, input.profileId),
          eq(table.state, SandboxProfileVersionStates.DRAFT),
        ),
    });

    return {
      discardedVersion: deletedVersion.version,
      hasDraft: remainingDraft !== undefined,
    };
  });
}

export type { DiscardProfileVersionDraftInput, DiscardProfileVersionDraftOutput };
