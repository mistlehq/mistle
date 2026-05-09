import {
  type InsertSandboxProfile,
  type SandboxProfile,
  getControlPlaneDatabaseSchema,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";

import { createDefaultProfileVersionRuntimeConfig } from "./profile-version-runtime-config.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type CreateProfileInput = {
  organizationId: string;
} & InsertSandboxProfile;

const INITIAL_SANDBOX_PROFILE_VERSION = 1;

export async function createProfile(
  {
    db,
    integrationRegistry,
    sandboxConfig,
  }: Pick<CreateSandboxProfilesServiceInput, "db" | "integrationRegistry" | "sandboxConfig">,
  serviceInput: CreateProfileInput,
): Promise<SandboxProfile> {
  return db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);
    const initialRuntimeConfig = createDefaultProfileVersionRuntimeConfig({
      integrationRegistry,
      sandboxConfig,
    });

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
        ...initialRuntimeConfig,
      })
      .returning();

    if (createdInitialVersion === undefined) {
      throw new Error("Failed to create initial sandbox profile version.");
    }

    return createdProfile;
  });
}
