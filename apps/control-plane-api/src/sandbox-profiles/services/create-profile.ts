import {
  type SandboxProfile,
  getControlPlaneDatabaseSchema,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";

import { SandboxProfilesBadRequestCodes, SandboxProfilesBadRequestError } from "../errors.js";
import {
  createDefaultProfileVersionRuntimeConfig,
  mapProfileVersionRuntimeConfig,
  validateSandboxProfileVersionRuntimeConfig,
  type SandboxProfileVersionResources,
} from "./profile-version-runtime-config.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type CreateProfileInput = {
  displayName: string;
  organizationId: string;
  sandboxProvider?: string;
  sandboxResources?: SandboxProfileVersionResources | null;
};

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
    const explicitRuntimeConfig = {
      ...initialRuntimeConfig,
      ...(serviceInput.sandboxProvider === undefined
        ? {}
        : { sandboxProvider: serviceInput.sandboxProvider }),
      ...(serviceInput.sandboxResources === undefined
        ? {}
        : mapSandboxResourcesToColumns(serviceInput.sandboxResources)),
    };

    if (serviceInput.sandboxProvider !== undefined || serviceInput.sandboxResources !== undefined) {
      const validationIssues = await validateSandboxProfileVersionRuntimeConfig(
        { db: tx, integrationRegistry, sandboxConfig },
        {
          organizationId: serviceInput.organizationId,
          runtimeConfig: mapProfileVersionRuntimeConfig(explicitRuntimeConfig),
        },
      );
      const firstIssue = validationIssues[0];
      if (firstIssue !== undefined) {
        throw new SandboxProfilesBadRequestError(
          SandboxProfilesBadRequestCodes.INVALID_SANDBOX_RUNTIME_CONFIG,
          firstIssue.message,
        );
      }
    }

    const [createdProfile] = await tx
      .insert(tables.sandboxProfiles)
      .values({
        displayName: serviceInput.displayName,
        organizationId: serviceInput.organizationId,
      })
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
        ...explicitRuntimeConfig,
      })
      .returning();

    if (createdInitialVersion === undefined) {
      throw new Error("Failed to create initial sandbox profile version.");
    }

    return createdProfile;
  });
}

function mapSandboxResourcesToColumns(
  resources: SandboxProfileVersionResources | null,
): Pick<
  ReturnType<typeof createDefaultProfileVersionRuntimeConfig>,
  "sandboxVcpuCount" | "sandboxMemoryMb" | "sandboxDiskMb"
> {
  if (resources === null) {
    return {
      sandboxVcpuCount: null,
      sandboxMemoryMb: null,
      sandboxDiskMb: null,
    };
  }

  return {
    sandboxVcpuCount: resources.vcpuCount,
    sandboxMemoryMb: resources.memoryMb,
    sandboxDiskMb: resources.diskMb ?? null,
  };
}
