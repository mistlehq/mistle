import type { InsertSandboxProfile, SandboxProfile } from "@mistle/db/control-plane";

import { sandboxProfiles } from "@mistle/db/control-plane";

import type { CreateSandboxProfilesServiceInput } from "./types.js";

type CreateProfileInput = {
  organizationId: string;
} & InsertSandboxProfile;

export async function createProfile(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  serviceInput: CreateProfileInput,
): Promise<SandboxProfile> {
  const [createdProfile] = await db.insert(sandboxProfiles).values(serviceInput).returning();

  if (createdProfile === undefined) {
    throw new Error("Failed to create sandbox profile.");
  }

  return createdProfile;
}
