import {
  type InsertSandboxProfile,
  type SandboxProfile,
  getControlPlaneDatabaseSchema,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";

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
    const tables = getControlPlaneDatabaseSchema(tx);

    const [createdProfile] = await tx
      .insert(tables.sandboxProfiles)
      .values(serviceInput)
      .returning();

    if (createdProfile === undefined) {
      throw new Error("Failed to create sandbox profile.");
    }

    const [createdInitialVersion] = await tx
      .insert(tables.sandboxProfileVersions)
      .values({
        sandboxProfileId: createdProfile.id,
        version: INITIAL_SANDBOX_PROFILE_VERSION,
        state: SandboxProfileVersionStates.DRAFT,
      })
      .returning();

    if (createdInitialVersion === undefined) {
      throw new Error("Failed to create initial sandbox profile version.");
    }

    return createdProfile;
  });
}
