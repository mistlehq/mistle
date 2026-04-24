import type { SandboxProfileVersionState } from "@mistle/db/control-plane";

import { SandboxProfilesNotFoundCodes, SandboxProfilesNotFoundError } from "../errors.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type ListProfileVersionsInput = {
  organizationId: string;
  profileId: string;
};

type ListProfileVersionsOutput = {
  versions: Array<{
    sandboxProfileId: string;
    version: number;
    state: SandboxProfileVersionState;
    isActive: boolean;
  }>;
};

export async function listProfileVersions(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: ListProfileVersionsInput,
): Promise<ListProfileVersionsOutput> {
  const sandboxProfile = await db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
      activeVersion: true,
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

  const versions = await db.query.sandboxProfileVersions.findMany({
    columns: {
      sandboxProfileId: true,
      version: true,
      state: true,
    },
    where: (table, { eq }) => eq(table.sandboxProfileId, input.profileId),
    orderBy: (table, { desc }) => [desc(table.version)],
  });

  return {
    versions: versions.map((version) => ({
      ...version,
      isActive: version.version === sandboxProfile.activeVersion,
    })),
  };
}

export type { ListProfileVersionsInput, ListProfileVersionsOutput };
