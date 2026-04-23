import { SandboxProfilesNotFoundCodes, SandboxProfilesNotFoundError } from "../errors.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type GetProfileVersionSetupScriptInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
};

type GetProfileVersionSetupScriptOutput = {
  sandboxProfileId: string;
  version: number;
  setupScript: string | null;
};

export async function getProfileVersionSetupScript(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: GetProfileVersionSetupScriptInput,
): Promise<GetProfileVersionSetupScriptOutput> {
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

  const sandboxProfileVersion = await db.query.sandboxProfileVersions.findFirst({
    columns: {
      sandboxProfileId: true,
      version: true,
      setupScript: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.sandboxProfileId, input.profileId), eq(table.version, input.profileVersion)),
  });

  if (sandboxProfileVersion === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
      "Sandbox profile version was not found.",
    );
  }

  return {
    sandboxProfileId: sandboxProfileVersion.sandboxProfileId,
    version: sandboxProfileVersion.version,
    setupScript: sandboxProfileVersion.setupScript,
  };
}

export type { GetProfileVersionSetupScriptInput, GetProfileVersionSetupScriptOutput };
