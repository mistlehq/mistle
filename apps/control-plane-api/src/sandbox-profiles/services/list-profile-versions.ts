import type { SandboxProfileVersion } from "@mistle/db/control-plane";

import { SandboxProfilesNotFoundCodes, SandboxProfilesNotFoundError } from "./errors.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type ListProfileVersionsInput = {
  organizationId: string;
  profileId: string;
};

type ListProfileVersionsOutput = {
  versions: SandboxProfileVersion[];
};

export async function listProfileVersions(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: ListProfileVersionsInput,
): Promise<ListProfileVersionsOutput> {
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

  const versions = await db.query.sandboxProfileVersions.findMany({
    where: (table, { eq }) => eq(table.sandboxProfileId, input.profileId),
    orderBy: (table, { desc }) => [desc(table.version)],
  });

  return {
    versions,
  };
}

export type { ListProfileVersionsInput, ListProfileVersionsOutput };
