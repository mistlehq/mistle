import { getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import { and, eq } from "drizzle-orm";

import {
  SandboxProfilesConflictCodes,
  SandboxProfilesConflictError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

export async function resolveMaintenanceSnapshotImageId(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
  },
): Promise<string> {
  const tables = getControlPlaneDatabaseSchema(db);
  const [sandboxProfileVersion] = await db
    .select({
      sandboxProfileId: tables.sandboxProfileVersions.sandboxProfileId,
      snapshotImageId: tables.sandboxProfileVersions.snapshotImageId,
    })
    .from(tables.sandboxProfiles)
    .leftJoin(
      tables.sandboxProfileVersions,
      and(
        eq(tables.sandboxProfileVersions.sandboxProfileId, tables.sandboxProfiles.id),
        eq(tables.sandboxProfileVersions.version, input.profileVersion),
      ),
    )
    .where(
      and(
        eq(tables.sandboxProfiles.id, input.profileId),
        eq(tables.sandboxProfiles.organizationId, input.organizationId),
      ),
    );

  if (sandboxProfileVersion === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
      "Sandbox profile was not found.",
    );
  }

  if (sandboxProfileVersion.sandboxProfileId === null) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
      "Sandbox profile version was not found.",
    );
  }

  if (sandboxProfileVersion.snapshotImageId === null) {
    throw new SandboxProfilesConflictError(
      SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_USABLE,
      `Sandbox profile version '${String(input.profileVersion)}' does not have a usable snapshot.`,
    );
  }

  return sandboxProfileVersion.snapshotImageId;
}
