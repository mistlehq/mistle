import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import { SandboxProfilesNotFoundCodes, SandboxProfilesNotFoundError } from "../errors.js";

export async function readProfileVersionGitCommitSigningIntegrationConnectionId(
  db: ControlPlaneDatabase,
  input: {
    profileId: string;
    profileVersion: number;
  },
): Promise<string | null> {
  const sandboxProfileVersion = await db.query.sandboxProfileVersions.findFirst({
    columns: {
      gitCommitSigningIntegrationConnectionId: true,
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

  return sandboxProfileVersion.gitCommitSigningIntegrationConnectionId;
}
