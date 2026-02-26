import type { InsertSandboxProfile, SandboxProfile } from "@mistle/db/control-plane";

import { sandboxProfiles, sandboxProfileVersions } from "@mistle/db/control-plane";

import type { CreateSandboxProfilesServiceInput } from "./types.js";

type CreateProfileInput = {
  organizationId: string;
} & InsertSandboxProfile;

const INITIAL_SANDBOX_PROFILE_VERSION = 1;

export async function createProfile(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  serviceInput: CreateProfileInput,
): Promise<SandboxProfile> {
  return db.transaction(async (tx) => {
    const [createdProfile] = await tx.insert(sandboxProfiles).values(serviceInput).returning();

    if (createdProfile === undefined) {
      throw new Error("Failed to create sandbox profile.");
    }

    const [createdInitialVersion] = await tx
      .insert(sandboxProfileVersions)
      .values({
        sandboxProfileId: createdProfile.id,
        version: INITIAL_SANDBOX_PROFILE_VERSION,
        manifest: {},
      })
      .returning();

    if (createdInitialVersion === undefined) {
      throw new Error("Failed to create initial sandbox profile version.");
    }

    return createdProfile;
  });
}
