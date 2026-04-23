import { sandboxProfileVersions } from "@mistle/db/control-plane";
import { and, eq } from "drizzle-orm";

import { SandboxProfilesNotFoundCodes, SandboxProfilesNotFoundError } from "../errors.js";
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

  const [updatedVersion] = await db
    .update(sandboxProfileVersions)
    .set({
      setupScript: input.setupScript,
    })
    .where(
      and(
        eq(sandboxProfileVersions.sandboxProfileId, input.profileId),
        eq(sandboxProfileVersions.version, input.profileVersion),
      ),
    )
    .returning({
      sandboxProfileId: sandboxProfileVersions.sandboxProfileId,
      version: sandboxProfileVersions.version,
      setupScript: sandboxProfileVersions.setupScript,
    });

  if (updatedVersion === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
      "Sandbox profile version was not found.",
    );
  }

  return updatedVersion;
}

export type { PutProfileVersionSetupScriptInput, PutProfileVersionSetupScriptOutput };
