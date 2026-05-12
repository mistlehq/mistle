import type { ControlPlaneDatabase, ControlPlaneTransaction } from "@mistle/db/control-plane";
import { SandboxProfileVersionStates } from "@mistle/db/control-plane";

import {
  SandboxProfilePublishabilityIssueCodes,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
  type SandboxProfilePublishabilityIssueCode,
} from "../errors.js";
import {
  mapProfileVersionRuntimeConfig,
  validateSandboxProfileVersionRuntimeConfig,
} from "./profile-version-runtime-config.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

export type SandboxProfilePublishabilityIssue = {
  code: SandboxProfilePublishabilityIssueCode;
  message: string;
  bindingId?: string;
  connectionId?: string;
  targetKey?: string;
};

type GetProfileVersionPublishabilityContext = {
  db: ControlPlaneDatabase | ControlPlaneTransaction;
} & Pick<CreateSandboxProfilesServiceInput, "integrationRegistry" | "sandboxConfig">;

type GetProfileVersionPublishabilityInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
};

type GetProfileVersionPublishabilityOutput = {
  publishable: boolean;
  issues: SandboxProfilePublishabilityIssue[];
};

export async function getProfileVersionPublishability(
  { db, integrationRegistry, sandboxConfig }: GetProfileVersionPublishabilityContext,
  input: GetProfileVersionPublishabilityInput,
): Promise<GetProfileVersionPublishabilityOutput> {
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
      state: true,
      sandboxProvider: true,
      sandboxConnectionId: true,
      sandboxVcpuCount: true,
      sandboxMemoryMb: true,
      sandboxStorageMb: true,
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

  if (sandboxProfileVersion.state !== SandboxProfileVersionStates.DRAFT) {
    return {
      publishable: false,
      issues: [
        {
          code: SandboxProfilePublishabilityIssueCodes.PROFILE_VERSION_NOT_DRAFT,
          message: `Sandbox profile version '${String(input.profileVersion)}' is not a draft.`,
        },
      ],
    };
  }

  const issues: SandboxProfilePublishabilityIssue[] = [
    ...(await validateSandboxProfileVersionRuntimeConfig(
      { db, integrationRegistry, sandboxConfig },
      {
        organizationId: input.organizationId,
        runtimeConfig: mapProfileVersionRuntimeConfig(sandboxProfileVersion),
      },
    )),
  ];

  return {
    publishable: issues.length === 0,
    issues,
  };
}
