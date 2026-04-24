import {
  sandboxProfiles,
  sandboxProfileVersions,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { sql } from "drizzle-orm";

import {
  SandboxProfilesConflictCodes,
  SandboxProfilesConflictError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import { getProfileVersionPublishability } from "./get-profile-version-publishability.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type PublishProfileVersionInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
};

type PublishProfileVersionOutput = {
  version: {
    sandboxProfileId: string;
    version: number;
    state: (typeof SandboxProfileVersionStates)[keyof typeof SandboxProfileVersionStates];
    isActive: boolean;
  };
  activeVersion: number;
};

export async function publishProfileVersion(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: PublishProfileVersionInput,
): Promise<PublishProfileVersionOutput> {
  return db.transaction(async (tx) => {
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

    const sandboxProfileVersion = await tx.query.sandboxProfileVersions.findFirst({
      columns: {
        sandboxProfileId: true,
        version: true,
        state: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, input.profileId), eq(table.version, input.profileVersion)),
    });

    if (sandboxProfileVersion === undefined) {
      throw new SandboxProfilesNotFoundError(
        SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
        "Sandbox profile version was not found.",
      );
    }

    if (sandboxProfileVersion.state !== SandboxProfileVersionStates.DRAFT) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_DRAFT,
        `Sandbox profile version '${String(input.profileVersion)}' is not a draft.`,
      );
    }

    const publishability = await getProfileVersionPublishability(
      {
        db: tx,
      },
      input,
    );

    if (!publishability.publishable) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_PUBLISHABLE,
        `Sandbox profile version '${String(input.profileVersion)}' is not publishable.`,
      );
    }

    const [publishedVersion] = await tx
      .update(sandboxProfileVersions)
      .set({
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: sql`now()`,
      })
      .where(
        sql`${sandboxProfileVersions.sandboxProfileId} = ${input.profileId}
          and ${sandboxProfileVersions.version} = ${input.profileVersion}
          and ${sandboxProfileVersions.state} = ${SandboxProfileVersionStates.DRAFT}`,
      )
      .returning({
        sandboxProfileId: sandboxProfileVersions.sandboxProfileId,
        version: sandboxProfileVersions.version,
        state: sandboxProfileVersions.state,
      });

    if (publishedVersion === undefined) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_DRAFT,
        `Sandbox profile version '${String(input.profileVersion)}' is not a draft.`,
      );
    }

    const [updatedProfile] = await tx
      .update(sandboxProfiles)
      .set({
        activeVersion: input.profileVersion,
      })
      .where(sql`${sandboxProfiles.id} = ${input.profileId}`)
      .returning({
        activeVersion: sandboxProfiles.activeVersion,
      });

    if (updatedProfile === undefined || updatedProfile.activeVersion === null) {
      throw new Error(
        `Failed to set active version '${String(input.profileVersion)}' for sandbox profile '${input.profileId}'.`,
      );
    }

    return {
      version: {
        ...publishedVersion,
        isActive: true,
      },
      activeVersion: updatedProfile.activeVersion,
    };
  });
}
