import type { SandboxProfile } from "@mistle/db/control-plane";

import { SandboxProfilesNotFoundCodes, SandboxProfilesNotFoundError } from "./errors.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type GetProfileInput = {
  organizationId: string;
  profileId: string;
};

export async function getProfile(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  serviceInput: GetProfileInput,
): Promise<SandboxProfile> {
  const profile = await db.query.sandboxProfiles.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.id, serviceInput.profileId),
        eq(table.organizationId, serviceInput.organizationId),
      ),
  });

  if (profile === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
      "Sandbox profile was not found.",
    );
  }

  return profile;
}
