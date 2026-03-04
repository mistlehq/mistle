import type { SandboxProfileVersionIntegrationBinding } from "@mistle/db/control-plane";

import { SandboxProfilesNotFoundCodes, SandboxProfilesNotFoundError } from "./errors.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type GetProfileVersionIntegrationBindingsInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
};

type GetProfileVersionIntegrationBindingsOutput = {
  bindings: SandboxProfileVersionIntegrationBinding[];
};

export async function getProfileVersionIntegrationBindings(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: GetProfileVersionIntegrationBindingsInput,
): Promise<GetProfileVersionIntegrationBindingsOutput> {
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

  const bindings = await db.query.sandboxProfileVersionIntegrationBindings.findMany({
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxProfileId, input.profileId),
        eq(table.sandboxProfileVersion, input.profileVersion),
      ),
    orderBy: (table, { asc }) => [asc(table.id)],
  });

  return {
    bindings,
  };
}

export type {
  GetProfileVersionIntegrationBindingsInput,
  GetProfileVersionIntegrationBindingsOutput,
};
