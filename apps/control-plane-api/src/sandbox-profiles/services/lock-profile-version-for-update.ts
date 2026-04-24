import type { ControlPlaneTransaction } from "@mistle/db/control-plane";
import { sandboxProfileVersions } from "@mistle/db/control-plane";
import { and, eq } from "drizzle-orm";

import { SandboxProfilesNotFoundCodes, SandboxProfilesNotFoundError } from "../errors.js";

export async function lockProfileVersionForUpdateOrThrow(input: {
  db: ControlPlaneTransaction;
  profileId: string;
  profileVersion: number;
}) {
  const [lockedVersion] = await input.db
    .select({
      sandboxProfileId: sandboxProfileVersions.sandboxProfileId,
      version: sandboxProfileVersions.version,
      state: sandboxProfileVersions.state,
    })
    .from(sandboxProfileVersions)
    .where(
      and(
        eq(sandboxProfileVersions.sandboxProfileId, input.profileId),
        eq(sandboxProfileVersions.version, input.profileVersion),
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

  return lockedVersion;
}
