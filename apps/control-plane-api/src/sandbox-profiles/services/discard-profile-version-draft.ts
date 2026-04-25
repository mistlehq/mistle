import { sandboxProfileVersions, SandboxProfileVersionStates } from "@mistle/db/control-plane";
import { and, eq } from "drizzle-orm";

import {
  SandboxProfilesConflictCodes,
  SandboxProfilesConflictError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import { lockProfileVersionForUpdateOrThrow } from "./lock-profile-version-for-update.js";
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

    const lockedVersion = await lockProfileVersionForUpdateOrThrow({
      db: tx,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
    });

    if (lockedVersion.state !== SandboxProfileVersionStates.DRAFT) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_DRAFT,
        `Sandbox profile version '${String(input.profileVersion)}' is not a draft.`,
      );
    }

    const [deletedVersion] = await tx
      .delete(sandboxProfileVersions)
      .where(
        and(
          eq(sandboxProfileVersions.sandboxProfileId, input.profileId),
          eq(sandboxProfileVersions.version, input.profileVersion),
          eq(sandboxProfileVersions.state, SandboxProfileVersionStates.DRAFT),
        ),
      )
      .returning({
        version: sandboxProfileVersions.version,
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
