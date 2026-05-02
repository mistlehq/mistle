import {
  getControlPlaneDatabaseSchema,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { and, eq } from "drizzle-orm";

import {
  SandboxProfilesConflictCodes,
  SandboxProfilesConflictError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type PutProfileVersionSetupScriptInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  setupScript: string | null;
};

type PutProfileVersionSetupScriptOutput = {
  sandboxProfileId: string;
  version: number;
  setupScript: string | null;
};

export async function putProfileVersionSetupScript(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: PutProfileVersionSetupScriptInput,
): Promise<PutProfileVersionSetupScriptOutput> {
  const tables = getControlPlaneDatabaseSchema(db);

  const sandboxProfile = await db.query.sandboxProfiles.findFirst({
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

  return db.transaction(async (tx) => {
    const [lockedVersion] = await tx
      .select({
        sandboxProfileId: tables.sandboxProfileVersions.sandboxProfileId,
        version: tables.sandboxProfileVersions.version,
        state: tables.sandboxProfileVersions.state,
      })
      .from(tables.sandboxProfileVersions)
      .where(
        and(
          eq(tables.sandboxProfileVersions.sandboxProfileId, input.profileId),
          eq(tables.sandboxProfileVersions.version, input.profileVersion),
        ),
      )
      .limit(1)
      .for("update");

    if (lockedVersion === undefined) {
      throw new SandboxProfilesNotFoundError(
        SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
        "Sandbox profile version was not found.",
      );
    }

    if (lockedVersion.state !== SandboxProfileVersionStates.DRAFT) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_DRAFT,
        `Sandbox profile version '${String(input.profileVersion)}' is not a draft.`,
      );
    }

    const [updatedVersion] = await tx
      .update(tables.sandboxProfileVersions)
      .set({
        setupScript: input.setupScript,
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
        setupScript: tables.sandboxProfileVersions.setupScript,
      });

    if (updatedVersion === undefined) {
      throw new SandboxProfilesNotFoundError(
        SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
        "Sandbox profile version was not found.",
      );
    }

    return updatedVersion;
  });
}

export type { PutProfileVersionSetupScriptInput, PutProfileVersionSetupScriptOutput };
