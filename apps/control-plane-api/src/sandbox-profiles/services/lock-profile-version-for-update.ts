import type { ControlPlaneTables, ControlPlaneTransaction } from "@mistle/db/control-plane";
import { and, eq } from "drizzle-orm";

import { SandboxProfilesNotFoundCodes, SandboxProfilesNotFoundError } from "../errors.js";

export async function lockProfileVersionForUpdateOrThrow(input: {
  db: ControlPlaneTransaction;
  tables: ControlPlaneTables;
  profileId: string;
  profileVersion: number;
}) {
  const { sandboxProfileVersions } = input.tables;
  const [lockedVersion] = await input.db
    .select({
      sandboxProfileId: sandboxProfileVersions.sandboxProfileId,
      version: sandboxProfileVersions.version,
      state: sandboxProfileVersions.state,
      sandboxProvider: sandboxProfileVersions.sandboxProvider,
      sandboxConnectionId: sandboxProfileVersions.sandboxConnectionId,
      sandboxVcpuCount: sandboxProfileVersions.sandboxVcpuCount,
      sandboxMemoryMb: sandboxProfileVersions.sandboxMemoryMb,
      sandboxStorageMb: sandboxProfileVersions.sandboxStorageMb,
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
