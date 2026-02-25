import type { SandboxProfile, SandboxProfileStatus } from "@mistle/db/control-plane";

import { sandboxProfiles } from "@mistle/db/control-plane";
import { and, eq, sql, type SQL } from "drizzle-orm";

import type { CreateSandboxProfilesServiceInput } from "./types.js";

import { SandboxProfilesNotFoundCodes, SandboxProfilesNotFoundError } from "./errors.js";

type UpdateProfileInput = {
  organizationId: string;
  profileId: string;
  displayName?: string | undefined;
  status?: SandboxProfileStatus | undefined;
};

export async function updateProfile(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  serviceInput: UpdateProfileInput,
): Promise<SandboxProfile> {
  const updateValues: {
    displayName?: string;
    status?: SandboxProfileStatus;
    updatedAt: SQL;
  } = {
    updatedAt: sql`now()`,
  };
  if (serviceInput.displayName !== undefined) {
    updateValues.displayName = serviceInput.displayName;
  }
  if (serviceInput.status !== undefined) {
    updateValues.status = serviceInput.status;
  }

  const [updatedProfile] = await db
    .update(sandboxProfiles)
    .set(updateValues)
    .where(
      and(
        eq(sandboxProfiles.id, serviceInput.profileId),
        eq(sandboxProfiles.organizationId, serviceInput.organizationId),
      ),
    )
    .returning();

  if (updatedProfile === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
      "Sandbox profile was not found.",
    );
  }

  return updatedProfile;
}
