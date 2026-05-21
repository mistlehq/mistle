import { getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import { and, eq } from "drizzle-orm";

import { SandboxProfilesNotFoundCodes, SandboxProfilesNotFoundError } from "../errors.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

export type PutProfileVersionMaintenanceScriptInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  maintenanceScript: string | null;
};

export type PutProfileVersionMaintenanceScriptOutput = {
  sandboxProfileId: string;
  version: number;
  maintenanceScript: string | null;
};

export async function putProfileVersionMaintenanceScript(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: PutProfileVersionMaintenanceScriptInput,
): Promise<PutProfileVersionMaintenanceScriptOutput> {
  const tables = getControlPlaneDatabaseSchema(db);
  const [updatedVersion] = await db
    .update(tables.sandboxProfileVersions)
    .set({
      maintenanceScript: input.maintenanceScript,
    })
    .from(tables.sandboxProfiles)
    .where(
      and(
        eq(tables.sandboxProfileVersions.sandboxProfileId, input.profileId),
        eq(tables.sandboxProfileVersions.version, input.profileVersion),
        eq(tables.sandboxProfiles.id, input.profileId),
        eq(tables.sandboxProfiles.organizationId, input.organizationId),
      ),
    )
    .returning({
      sandboxProfileId: tables.sandboxProfileVersions.sandboxProfileId,
      version: tables.sandboxProfileVersions.version,
      maintenanceScript: tables.sandboxProfileVersions.maintenanceScript,
    });

  if (updatedVersion === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
      "Sandbox profile version was not found.",
    );
  }

  return updatedVersion;
}
