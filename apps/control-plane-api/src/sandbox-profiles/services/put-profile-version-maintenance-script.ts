import { getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import { and, eq } from "drizzle-orm";

import { SandboxProfilesNotFoundCodes, SandboxProfilesNotFoundError } from "../errors.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type PutProfileVersionMaintenanceScriptInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  maintenanceScript: string | null;
};

type PutProfileVersionMaintenanceScriptOutput = {
  sandboxProfileId: string;
  version: number;
  maintenanceScript: string | null;
};

export async function putProfileVersionMaintenanceScript(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: PutProfileVersionMaintenanceScriptInput,
): Promise<PutProfileVersionMaintenanceScriptOutput> {
  const profile = await db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.profileId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });

  if (profile === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
      "Sandbox profile was not found.",
    );
  }

  const tables = getControlPlaneDatabaseSchema(db);
  const [updatedVersion] = await db
    .update(tables.sandboxProfileVersions)
    .set({
      maintenanceScript: input.maintenanceScript,
    })
    .where(
      and(
        eq(tables.sandboxProfileVersions.sandboxProfileId, input.profileId),
        eq(tables.sandboxProfileVersions.version, input.profileVersion),
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
