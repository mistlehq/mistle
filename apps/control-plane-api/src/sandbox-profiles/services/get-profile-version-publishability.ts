import type {
  ControlPlaneDatabase,
  ControlPlaneTransaction,
  SandboxProfileVersionSkillsConfig,
} from "@mistle/db/control-plane";
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
import { canonicalizePublicGitHubSkillsSourceOriginUrl } from "./profile-version-skills-config.js";
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
      sandboxDiskMb: true,
      skillsConfig: true,
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
    ...(await validateSandboxProfileVersionSkillsConfig(
      { db },
      {
        organizationId: input.organizationId,
        profileId: input.profileId,
        profileVersion: input.profileVersion,
        skillsConfig: sandboxProfileVersion.skillsConfig,
      },
    )),
  ];

  return {
    publishable: issues.length === 0,
    issues,
  };
}

async function validateSandboxProfileVersionSkillsConfig(
  { db }: Pick<GetProfileVersionPublishabilityContext, "db">,
  input: GetProfileVersionPublishabilityInput & {
    skillsConfig: SandboxProfileVersionSkillsConfig | null;
  },
): Promise<SandboxProfilePublishabilityIssue[]> {
  if (input.skillsConfig === null) {
    return [];
  }

  const skillsConfig = input.skillsConfig;
  const publicOriginUrl = canonicalizePublicGitHubSkillsSourceOriginUrl(skillsConfig.originUrl);
  if (publicOriginUrl !== skillsConfig.originUrl) {
    const skillsSourceIsBound = await profileVersionIncludesSkillsSource({
      db,
      organizationId: input.organizationId,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
      originUrl: skillsConfig.originUrl,
    });
    if (!skillsSourceIsBound) {
      return [
        {
          code: SandboxProfilePublishabilityIssueCodes.SKILLS_SOURCE_NOT_BOUND,
          message:
            "Add this repository to the Git integration bindings before publishing this sandbox profile.",
        },
      ];
    }
  }

  const skillsSourceRepo = await db.query.skillsSourceRepos.findFirst({
    columns: {
      skills: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.originUrl, skillsConfig.originUrl),
      ),
  });

  if (skillsSourceRepo === undefined) {
    return [
      {
        code: SandboxProfilePublishabilityIssueCodes.SKILLS_SOURCE_NOT_LOADED,
        message: "Load skills before publishing this sandbox profile.",
      },
    ];
  }

  const loadedSkillNamesByPath = new Map(
    skillsSourceRepo.skills.map((skill) => [skill.relativePath, skill.name]),
  );
  const hasMissingSelectedSkill = skillsConfig.selectedSkills.some(
    (skill) => loadedSkillNamesByPath.get(skill.relativePath) !== skill.name,
  );
  if (!hasMissingSelectedSkill) {
    return [];
  }

  return [
    {
      code: SandboxProfilePublishabilityIssueCodes.SELECTED_SKILLS_NOT_FOUND,
      message: "Remove skills that are no longer found before publishing this sandbox profile.",
    },
  ];
}

async function profileVersionIncludesSkillsSource(input: {
  db: ControlPlaneDatabase | ControlPlaneTransaction;
  organizationId: string;
  profileId: string;
  profileVersion: number;
  originUrl: string;
}): Promise<boolean> {
  const gitBindings = await input.db.query.sandboxProfileVersionIntegrationBindings.findMany({
    columns: {
      connectionId: true,
      config: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxProfileId, input.profileId),
        eq(table.sandboxProfileVersion, input.profileVersion),
        eq(table.kind, "git"),
      ),
  });

  if (gitBindings.length === 0) {
    return false;
  }

  const connectionIds = [...new Set(gitBindings.map((binding) => binding.connectionId))];
  const connections = await input.db.query.integrationConnections.findMany({
    columns: {
      id: true,
      targetKey: true,
    },
    where: (table, { and, eq, inArray }) =>
      and(eq(table.organizationId, input.organizationId), inArray(table.id, connectionIds)),
  });
  const connectionsById = new Map(connections.map((connection) => [connection.id, connection]));
  const targetKeys = [...new Set(connections.map((connection) => connection.targetKey))];
  if (targetKeys.length === 0) {
    return false;
  }

  const targets = await input.db.query.integrationTargets.findMany({
    columns: {
      targetKey: true,
      familyId: true,
      config: true,
    },
    where: (table, { inArray }) => inArray(table.targetKey, targetKeys),
  });
  const targetsByKey = new Map(targets.map((target) => [target.targetKey, target]));

  for (const binding of gitBindings) {
    const connection = connectionsById.get(binding.connectionId);
    if (connection === undefined) {
      continue;
    }

    const target = targetsByKey.get(connection.targetKey);
    if (target === undefined || target.familyId !== "github") {
      continue;
    }

    const webBaseUrl = readStringField(target.config, "web_base_url");
    const repositories = readStringArrayField(binding.config, "repositories");
    if (webBaseUrl === null || repositories === null) {
      continue;
    }

    if (
      repositories.some(
        (repository) =>
          createGitRepositoryOriginUrl({
            repository,
            webBaseUrl,
          }) === input.originUrl,
      )
    ) {
      return true;
    }
  }

  return false;
}

function createGitRepositoryOriginUrl(input: { repository: string; webBaseUrl: string }): string {
  const originUrl = new URL(input.webBaseUrl);
  const pathnameWithoutTrailingSlash = originUrl.pathname.endsWith("/")
    ? originUrl.pathname.slice(0, -1)
    : originUrl.pathname;
  const basePath = pathnameWithoutTrailingSlash === "/" ? "" : pathnameWithoutTrailingSlash;
  originUrl.pathname = `${basePath}/${input.repository}.git`;
  originUrl.search = "";
  originUrl.hash = "";

  return originUrl.toString();
}

function readStringField(input: Record<string, unknown>, field: string): string | null {
  const value = input[field];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readStringArrayField(
  input: Record<string, unknown>,
  field: string,
): readonly string[] | null {
  const value = input[field];
  if (!Array.isArray(value)) {
    return null;
  }

  const values = value.filter((item): item is string => typeof item === "string");
  return values.length === value.length ? values : null;
}
