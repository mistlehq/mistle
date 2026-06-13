import { isDeepStrictEqual } from "node:util";

import type {
  ControlPlaneDatabase,
  ControlPlaneTransaction,
  IntegrationBindingKind,
  SandboxProfileVersionAgentRuntimeId,
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
  mapProfileVersionAssociatedResourceEventRoutingConfig,
  type SandboxProfileAssociatedResourceEventRoutingConfig,
} from "./profile-version-associated-resource-routing-config.js";
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

type PublishWorthyProfileVersionFields = {
  version: number;
  setupScript: string | null;
  agentRuntimeId: SandboxProfileVersionAgentRuntimeId;
  gitCommitSigningIntegrationConnectionId: string | null;
  mistleMcpEnabled: boolean;
  mistleMcpApiKeyId: string | null;
  sandboxProvider: string | null;
  sandboxConnectionId: string | null;
  sandboxVcpuCount: number | null;
  sandboxMemoryMb: number | null;
  sandboxDiskMb: number | null;
  skillsConfig: SandboxProfileVersionSkillsConfig | null;
  associatedResourceEventRoutingConfig: SandboxProfileAssociatedResourceEventRoutingConfig;
};

type PublishWorthyIntegrationBindingFields = {
  connectionId: string;
  kind: IntegrationBindingKind;
  config: Record<string, unknown>;
};

type CanonicalPublishWorthyProfileVersionConfig = {
  setupScript: string | null;
  agentRuntimeId: SandboxProfileVersionAgentRuntimeId;
  gitCommitSigningIntegrationConnectionId: string | null;
  mistleMcpEnabled: boolean;
  mistleMcpApiKeyId: string | null;
  sandboxProvider: string | null;
  sandboxConnectionId: string | null;
  sandboxVcpuCount: number | null;
  sandboxMemoryMb: number | null;
  sandboxDiskMb: number | null;
  skillsConfig: {
    originUrl: string;
    selectedSkills: ReadonlyArray<{
      name: string;
      relativePath: string;
    }>;
  } | null;
  associatedResourceEventRoutingConfig: {
    enabled?: boolean;
    resources?: ReadonlyArray<{
      resourceKind: string;
      eventTypes: readonly string[];
      payloadFilter?: unknown;
    }>;
  };
  integrationBindings: ReadonlyArray<{
    connectionId: string;
    kind: IntegrationBindingKind;
    config: unknown;
  }>;
};

const PublishWorthyProfileVersionColumns = {
  version: true,
  setupScript: true,
  agentRuntimeId: true,
  gitCommitSigningIntegrationConnectionId: true,
  mistleMcpEnabled: true,
  mistleMcpApiKeyId: true,
  sandboxProvider: true,
  sandboxConnectionId: true,
  sandboxVcpuCount: true,
  sandboxMemoryMb: true,
  sandboxDiskMb: true,
  skillsConfig: true,
  associatedResourceEventRoutingConfig: true,
} satisfies Record<keyof PublishWorthyProfileVersionFields, true>;

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
      ...PublishWorthyProfileVersionColumns,
      state: true,
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

  if (issues.length === 0) {
    issues.push(
      ...(await validateSandboxProfileVersionHasPublishWorthyChange(
        { db },
        {
          profileId: input.profileId,
          draftVersion: sandboxProfileVersion,
        },
      )),
    );
  }

  return {
    publishable: issues.length === 0,
    issues,
  };
}

async function validateSandboxProfileVersionHasPublishWorthyChange(
  { db }: Pick<GetProfileVersionPublishabilityContext, "db">,
  input: {
    profileId: string;
    draftVersion: PublishWorthyProfileVersionFields;
  },
): Promise<SandboxProfilePublishabilityIssue[]> {
  const sourceVersion = await db.query.sandboxProfileVersions.findFirst({
    columns: PublishWorthyProfileVersionColumns,
    where: (table, { and, eq, lt }) =>
      and(
        eq(table.sandboxProfileId, input.profileId),
        eq(table.state, SandboxProfileVersionStates.PUBLISHED),
        lt(table.version, input.draftVersion.version),
      ),
    orderBy: (table, { desc }) => [desc(table.version)],
  });

  if (sourceVersion === undefined) {
    if (input.draftVersion.version === 1) {
      return [];
    }

    throw new Error(
      `Draft sandbox profile version '${String(input.draftVersion.version)}' has no source published version.`,
    );
  }

  const [sourceBindings, draftBindings] = await Promise.all([
    loadPublishWorthyIntegrationBindings({
      db,
      profileId: input.profileId,
      profileVersion: sourceVersion.version,
    }),
    loadPublishWorthyIntegrationBindings({
      db,
      profileId: input.profileId,
      profileVersion: input.draftVersion.version,
    }),
  ]);

  const sourceConfig = createCanonicalPublishWorthyProfileVersionConfig({
    version: sourceVersion,
    integrationBindings: sourceBindings,
  });
  const draftConfig = createCanonicalPublishWorthyProfileVersionConfig({
    version: input.draftVersion,
    integrationBindings: draftBindings,
  });

  if (!isDeepStrictEqual(sourceConfig, draftConfig)) {
    return [];
  }

  return [
    {
      code: SandboxProfilePublishabilityIssueCodes.NO_PUBLISH_WORTHY_CHANGE,
      message: "Make a change to the sandbox profile draft before publishing.",
    },
  ];
}

async function loadPublishWorthyIntegrationBindings(input: {
  db: ControlPlaneDatabase | ControlPlaneTransaction;
  profileId: string;
  profileVersion: number;
}): Promise<PublishWorthyIntegrationBindingFields[]> {
  return await input.db.query.sandboxProfileVersionIntegrationBindings.findMany({
    columns: {
      connectionId: true,
      kind: true,
      config: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxProfileId, input.profileId),
        eq(table.sandboxProfileVersion, input.profileVersion),
      ),
  });
}

function createCanonicalPublishWorthyProfileVersionConfig(input: {
  version: PublishWorthyProfileVersionFields;
  integrationBindings: readonly PublishWorthyIntegrationBindingFields[];
}): CanonicalPublishWorthyProfileVersionConfig {
  return {
    setupScript: normalizePublishWorthySetupScript(input.version.setupScript),
    agentRuntimeId: input.version.agentRuntimeId,
    gitCommitSigningIntegrationConnectionId: input.version.gitCommitSigningIntegrationConnectionId,
    mistleMcpEnabled: input.version.mistleMcpEnabled,
    mistleMcpApiKeyId: input.version.mistleMcpApiKeyId,
    sandboxProvider: input.version.sandboxProvider,
    sandboxConnectionId: input.version.sandboxConnectionId,
    sandboxVcpuCount: input.version.sandboxVcpuCount,
    sandboxMemoryMb: input.version.sandboxMemoryMb,
    sandboxDiskMb: input.version.sandboxDiskMb,
    skillsConfig: normalizePublishWorthySkillsConfig(input.version.skillsConfig),
    associatedResourceEventRoutingConfig:
      normalizePublishWorthyAssociatedResourceEventRoutingConfig(
        input.version.associatedResourceEventRoutingConfig,
      ),
    integrationBindings: input.integrationBindings
      .map((binding) => ({
        connectionId: binding.connectionId,
        kind: binding.kind,
        config: canonicalizeJsonValue(binding.config),
      }))
      .sort(compareCanonicalIntegrationBindings),
  };
}

function normalizePublishWorthySetupScript(script: string | null): string | null {
  if (script === null || script.trim().length === 0) {
    return null;
  }

  return script;
}

function normalizePublishWorthySkillsConfig(
  skillsConfig: SandboxProfileVersionSkillsConfig | null,
): CanonicalPublishWorthyProfileVersionConfig["skillsConfig"] {
  if (skillsConfig === null) {
    return null;
  }

  return {
    originUrl: skillsConfig.originUrl,
    selectedSkills: [...skillsConfig.selectedSkills].sort(compareSelectedSkills),
  };
}

function compareSelectedSkills(
  left: { name: string; relativePath: string },
  right: { name: string; relativePath: string },
): number {
  return left.relativePath.localeCompare(right.relativePath) || left.name.localeCompare(right.name);
}

function normalizePublishWorthyAssociatedResourceEventRoutingConfig(
  config: SandboxProfileAssociatedResourceEventRoutingConfig,
): CanonicalPublishWorthyProfileVersionConfig["associatedResourceEventRoutingConfig"] {
  const mappedConfig = mapProfileVersionAssociatedResourceEventRoutingConfig(config);

  return {
    ...(mappedConfig.enabled === undefined ? {} : { enabled: mappedConfig.enabled }),
    ...(mappedConfig.resources === undefined
      ? {}
      : {
          resources: mappedConfig.resources
            .map((resource) => ({
              resourceKind: resource.resourceKind,
              eventTypes: [...resource.eventTypes].sort(),
              ...(!("messageMode" in resource) || resource.messageMode === undefined
                ? {}
                : { messageMode: resource.messageMode }),
              ...(!("payloadFilter" in resource) || resource.payloadFilter === undefined
                ? {}
                : { payloadFilter: canonicalizeJsonValue(resource.payloadFilter) }),
              ...(!("config" in resource) || resource.config === undefined
                ? {}
                : { config: canonicalizeJsonValue(resource.config) }),
            }))
            .sort(compareAssociatedResourceEventRoutingResources),
        }),
  };
}

function compareAssociatedResourceEventRoutingResources(
  left: {
    resourceKind: string;
    eventTypes: readonly string[];
    config?: unknown;
    messageMode?: string;
    payloadFilter?: unknown;
  },
  right: {
    resourceKind: string;
    eventTypes: readonly string[];
    config?: unknown;
    messageMode?: string;
    payloadFilter?: unknown;
  },
): number {
  return (
    left.resourceKind.localeCompare(right.resourceKind) ||
    left.eventTypes.join("\u0000").localeCompare(right.eventTypes.join("\u0000")) ||
    (JSON.stringify(left.config) ?? "").localeCompare(JSON.stringify(right.config) ?? "") ||
    (left.messageMode ?? "").localeCompare(right.messageMode ?? "") ||
    (JSON.stringify(left.payloadFilter) ?? "").localeCompare(
      JSON.stringify(right.payloadFilter) ?? "",
    )
  );
}

function compareCanonicalIntegrationBindings(
  left: CanonicalPublishWorthyProfileVersionConfig["integrationBindings"][number],
  right: CanonicalPublishWorthyProfileVersionConfig["integrationBindings"][number],
): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.connectionId.localeCompare(right.connectionId) ||
    JSON.stringify(left.config).localeCompare(JSON.stringify(right.config))
  );
}

function isJsonRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function canonicalizeJsonValue(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(canonicalizeJsonValue);
  }

  if (!isJsonRecord(input)) {
    return input;
  }

  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    output[key] = canonicalizeJsonValue(input[key]);
  }

  return output;
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
