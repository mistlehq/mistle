import {
  IntegrationResourceSyncFailure,
  IntegrationResourceSyncFailureCodes,
  IntegrationConnectionMethodIds,
  type DiscoveredIntegrationResource,
  type DiscoveredIntegrationResourceRelationship,
  type ListConnectionResourcesInput,
  type ListConnectionResourcesResult,
} from "@mistle/integrations-core";
import { Octokit } from "octokit";
import { z } from "zod";

import { GitHubApiVersion } from "./api-version.js";
import { GitHubConnectionConfigSchema, type GitHubConnectionConfig } from "./auth.js";
import type { GitHubTargetConfig } from "./target-config-schema.js";
import type { GitHubTargetSecrets } from "./target-secret-schema.js";

const GitHubRepositorySchema = z.looseObject({
  id: z.union([z.string().min(1), z.number().int()]),
  full_name: z.string().min(1),
  owner: z
    .looseObject({
      id: z.union([z.string().min(1), z.number().int()]).optional(),
      login: z.string().min(1),
      type: z.string().min(1).optional(),
    })
    .optional(),
  default_branch: z.string().min(1).optional().nullable(),
  visibility: z.string().min(1).optional(),
  archived: z.boolean().optional(),
  private: z.boolean().optional(),
});

const GitHubBranchSchema = z.looseObject({
  name: z.string().min(1),
  protected: z.boolean().optional(),
});

const GitHubCollaboratorSchema = z.looseObject({
  id: z.union([z.string().min(1), z.number().int()]),
  login: z.string().min(1),
  type: z.string().min(1),
});

const GitHubTeamSchema = z.looseObject({
  id: z.union([z.string().min(1), z.number().int()]),
  name: z.string().min(1),
  slug: z.string().min(1),
  organization: z
    .looseObject({
      login: z.string().min(1),
    })
    .optional(),
});

const GitHubOrganizationInstallationSchema = z.looseObject({
  id: z.union([z.string().min(1), z.number().int()]),
  app_id: z.union([z.string().min(1), z.number().int()]),
  app_slug: z.string().min(1),
  account: z
    .looseObject({
      login: z.string().min(1),
      type: z.string().min(1).optional(),
    })
    .optional(),
});

const GitHubOrganizationInstallationsResponseSchema = z.looseObject({
  installations: z.array(GitHubOrganizationInstallationSchema),
});

const GitHubInstallationRepositoriesResponseSchema = z.looseObject({
  repositories: z.array(GitHubRepositorySchema),
});

const GitHubUserRepositoriesResponseSchema = z.array(GitHubRepositorySchema);

type GitHubRepository = z.output<typeof GitHubRepositorySchema>;
type GitHubBranch = z.output<typeof GitHubBranchSchema>;
type GitHubCollaborator = z.output<typeof GitHubCollaboratorSchema>;
type GitHubTeam = z.output<typeof GitHubTeamSchema>;
type GitHubOrganizationInstallation = z.output<typeof GitHubOrganizationInstallationSchema>;

type GitHubListConnectionResourcesInput = ListConnectionResourcesInput<
  GitHubTargetConfig,
  GitHubTargetSecrets,
  GitHubConnectionConfig
>;

const GitHubRepositoryKind = "repository";
const GitHubBranchKind = "branch";
const GitHubUserKind = "user";
const GitHubOrgKind = "org";
const GitHubTeamKind = "team";
const GitHubBotKind = "bot";
const GitHubPageSize = 100;

function createGitHubOctokit(input: { apiBaseUrl: string; token: string }): Octokit {
  return new Octokit({
    auth: input.token,
    baseUrl: input.apiBaseUrl,
    request: {
      headers: {
        "x-github-api-version": GitHubApiVersion,
      },
    },
  });
}

function readGitHubErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return null;
  }

  return typeof error.status === "number" ? error.status : null;
}

async function runGitHubResourceRequest<T>(input: {
  operation: string;
  request: () => Promise<T>;
}): Promise<T> {
  try {
    return await input.request();
  } catch (error) {
    const status = readGitHubErrorStatus(error);
    if (status === 403) {
      throw new IntegrationResourceSyncFailure(
        {
          code: IntegrationResourceSyncFailureCodes.PERMISSION_DENIED,
          message: `GitHub denied access while syncing resources during ${input.operation}. Review the GitHub App permissions and repository access for this connection.`,
          providerCode: "github_403",
        },
        { cause: error },
      );
    }

    if (status === 401) {
      throw new IntegrationResourceSyncFailure(
        {
          code: IntegrationResourceSyncFailureCodes.CREDENTIAL_FAILED,
          message: `GitHub rejected the credential while syncing resources during ${input.operation}. Reconnect this GitHub integration.`,
          providerCode: "github_401",
        },
        { cause: error },
      );
    }

    throw error;
  }
}

function toDiscoveredResource(resource: GitHubRepository): DiscoveredIntegrationResource {
  return {
    externalId: resource.id.toString(),
    handle: resource.full_name,
    displayName: resource.full_name,
    metadata: {
      ...(resource.default_branch === undefined || resource.default_branch === null
        ? {}
        : { defaultBranch: resource.default_branch }),
      visibility: resolveRepositoryVisibility(resource),
      archived: resource.archived ?? false,
    },
  };
}

function toBranchResource(input: {
  branch: GitHubBranch;
  repositoryFullName: string;
}): DiscoveredIntegrationResource {
  return {
    externalId: `${input.repositoryFullName}:${input.branch.name}`,
    handle: input.branch.name,
    displayName: input.branch.name,
    metadata: {
      repositoryFullName: input.repositoryFullName,
      protected: input.branch.protected ?? false,
    },
  };
}

function toUserResource(collaborator: GitHubCollaborator): DiscoveredIntegrationResource {
  return {
    externalId: collaborator.id.toString(),
    handle: collaborator.login,
    displayName: collaborator.login,
    metadata: {},
  };
}

function toOrgMembershipRelationship(input: {
  member: GitHubCollaborator;
  orgExternalId: string;
  orgHandle: string;
}): DiscoveredIntegrationResourceRelationship {
  return {
    relationshipKind: "belongs_to",
    subjectResourceKind: GitHubUserKind,
    subjectExternalId: input.member.id.toString(),
    subjectHandle: input.member.login,
    objectResourceKind: GitHubOrgKind,
    objectExternalId: input.orgExternalId,
    objectHandle: input.orgHandle,
    scopeKind: GitHubOrgKind,
    scopeExternalId: input.orgExternalId,
    scopeHandle: input.orgHandle,
    metadata: {
      organizationLogin: input.orgHandle,
    },
  };
}

function toOrgResource(input: { id: string; login: string }): DiscoveredIntegrationResource {
  return {
    externalId: input.id,
    handle: input.login,
    displayName: input.login,
    metadata: {
      login: input.login,
    },
  };
}

function toTeamMembershipRelationship(input: {
  member: GitHubCollaborator;
  teamExternalId: string;
  teamHandle: string;
}): DiscoveredIntegrationResourceRelationship {
  return {
    relationshipKind: "belongs_to",
    subjectResourceKind: GitHubUserKind,
    subjectExternalId: input.member.id.toString(),
    subjectHandle: input.member.login,
    objectResourceKind: GitHubTeamKind,
    objectExternalId: input.teamExternalId,
    objectHandle: input.teamHandle,
    scopeKind: GitHubTeamKind,
    scopeExternalId: input.teamExternalId,
    scopeHandle: input.teamHandle,
    metadata: {
      teamHandle: input.teamHandle,
    },
  };
}

function toTeamResource(input: {
  team: GitHubTeam;
  organizationLogin: string;
}): DiscoveredIntegrationResource {
  return {
    externalId: input.team.id.toString(),
    handle: `${input.organizationLogin}/${input.team.slug}`,
    displayName: `${input.team.name} (${input.organizationLogin})`,
    metadata: {
      organizationLogin: input.organizationLogin,
      organizationLogins: [input.organizationLogin],
      name: input.team.name,
      slug: input.team.slug,
    },
  };
}

function parseGitHubTeamScopeHandle(scopeHandle: string): {
  organizationLogin: string;
  teamSlug: string;
} {
  const [organizationLogin, teamSlug, extra] = scopeHandle.split("/");
  if (
    organizationLogin === undefined ||
    organizationLogin.length === 0 ||
    teamSlug === undefined ||
    teamSlug.length === 0 ||
    extra !== undefined
  ) {
    throw new Error(
      `GitHub team relationship listing requires an org-scoped team handle like 'org/team-slug'.`,
    );
  }

  return {
    organizationLogin,
    teamSlug,
  };
}

function toBotResource(input: {
  installation: GitHubOrganizationInstallation;
  organizationLogin: string;
}): DiscoveredIntegrationResource {
  const appId = input.installation.app_id.toString();
  const handle = `${input.installation.app_slug}[bot]`;

  return {
    externalId: appId,
    handle,
    displayName: handle,
    metadata: {
      appId,
      appSlug: input.installation.app_slug,
      installationIds: [input.installation.id.toString()],
      organizationLogins: [input.organizationLogin],
    },
  };
}

function resolveRepositoryVisibility(resource: GitHubRepository): string {
  if (resource.visibility !== undefined) {
    return resource.visibility;
  }

  return resource.private === true ? "private" : "public";
}

async function listGitHubInstallationRepositories(input: {
  apiBaseUrl: string;
  token: string;
}): Promise<ReadonlyArray<GitHubRepository>> {
  const octokit = createGitHubOctokit({
    apiBaseUrl: input.apiBaseUrl,
    token: input.token,
  });
  const repositories: GitHubRepository[] = [];

  for (let page = 1; ; page += 1) {
    const response = await runGitHubResourceRequest({
      operation: "installation repository listing",
      request: () =>
        octokit.rest.apps.listReposAccessibleToInstallation({
          per_page: GitHubPageSize,
          page,
        }),
    });
    const parsedResponse = GitHubInstallationRepositoriesResponseSchema.parse(response.data);
    repositories.push(...parsedResponse.repositories);

    if (parsedResponse.repositories.length < GitHubPageSize) {
      return repositories;
    }
  }
}

async function listGitHubUserRepositories(input: {
  apiBaseUrl: string;
  token: string;
}): Promise<ReadonlyArray<GitHubRepository>> {
  const octokit = createGitHubOctokit({
    apiBaseUrl: input.apiBaseUrl,
    token: input.token,
  });
  const repositories: GitHubRepository[] = [];

  for (let page = 1; ; page += 1) {
    const response = await runGitHubResourceRequest({
      operation: "authenticated user repository listing",
      request: () =>
        octokit.rest.repos.listForAuthenticatedUser({
          affiliation: "owner,collaborator,organization_member",
          sort: "full_name",
          per_page: GitHubPageSize,
          page,
        }),
    });
    const parsedResponse = GitHubUserRepositoriesResponseSchema.parse(response.data);
    repositories.push(...parsedResponse);

    if (parsedResponse.length < GitHubPageSize) {
      return repositories;
    }
  }
}

async function listGitHubRepositories(input: {
  apiBaseUrl: string;
  credential: string;
  connectionConfig: GitHubConnectionConfig;
}): Promise<ReadonlyArray<GitHubRepository>> {
  if (
    input.connectionConfig.connection_method ===
    IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
  ) {
    return listGitHubInstallationRepositories({
      apiBaseUrl: input.apiBaseUrl,
      token: input.credential,
    });
  }

  return listGitHubUserRepositories({
    apiBaseUrl: input.apiBaseUrl,
    token: input.credential,
  });
}

async function listGitHubRepositoryBranches(input: {
  apiBaseUrl: string;
  token: string;
  repository: GitHubRepository;
}): Promise<ReadonlyArray<GitHubBranch>> {
  const octokit = createGitHubOctokit({
    apiBaseUrl: input.apiBaseUrl,
    token: input.token,
  });
  const [owner, repo] = input.repository.full_name.split("/");
  if (owner === undefined || repo === undefined) {
    return [];
  }

  const branches: GitHubBranch[] = [];
  for (let page = 1; ; page += 1) {
    const response = await runGitHubResourceRequest({
      operation: `branch listing for ${input.repository.full_name}`,
      request: () =>
        octokit.rest.repos.listBranches({
          owner,
          repo,
          per_page: GitHubPageSize,
          page,
        }),
    });
    const parsedResponse = z.array(GitHubBranchSchema).parse(response.data);
    branches.push(...parsedResponse);

    if (parsedResponse.length < GitHubPageSize) {
      return branches;
    }
  }
}

async function listGitHubRepositoryCollaborators(input: {
  apiBaseUrl: string;
  token: string;
  repository: GitHubRepository;
}): Promise<ReadonlyArray<GitHubCollaborator>> {
  const octokit = createGitHubOctokit({
    apiBaseUrl: input.apiBaseUrl,
    token: input.token,
  });
  const [owner, repo] = input.repository.full_name.split("/");
  if (owner === undefined || repo === undefined) {
    return [];
  }

  const collaborators: GitHubCollaborator[] = [];
  for (let page = 1; ; page += 1) {
    const response = await runGitHubResourceRequest({
      operation: `collaborator listing for ${input.repository.full_name}`,
      request: () =>
        octokit.rest.repos.listCollaborators({
          owner,
          repo,
          per_page: GitHubPageSize,
          page,
        }),
    });

    const parsedResponse = z.array(GitHubCollaboratorSchema).parse(response.data);
    collaborators.push(...parsedResponse);

    if (parsedResponse.length < GitHubPageSize) {
      return collaborators;
    }
  }
}

async function listGitHubOrganizationTeams(input: {
  apiBaseUrl: string;
  token: string;
  organizationLogin: string;
}): Promise<ReadonlyArray<GitHubTeam>> {
  const octokit = createGitHubOctokit({
    apiBaseUrl: input.apiBaseUrl,
    token: input.token,
  });

  const teams: GitHubTeam[] = [];
  for (let page = 1; ; page += 1) {
    const response = await runGitHubResourceRequest({
      operation: `team listing for ${input.organizationLogin}`,
      request: () =>
        octokit.rest.teams.list({
          org: input.organizationLogin,
          per_page: GitHubPageSize,
          page,
        }),
    });
    const parsedResponse = z.array(GitHubTeamSchema).parse(response.data);
    teams.push(...parsedResponse);

    if (parsedResponse.length < GitHubPageSize) {
      return teams;
    }
  }
}

async function listGitHubOrganizationMembers(input: {
  apiBaseUrl: string;
  token: string;
  organizationLogin: string;
}): Promise<ReadonlyArray<GitHubCollaborator>> {
  const octokit = createGitHubOctokit({
    apiBaseUrl: input.apiBaseUrl,
    token: input.token,
  });

  const members: GitHubCollaborator[] = [];
  for (let page = 1; ; page += 1) {
    const response = await runGitHubResourceRequest({
      operation: `organization member listing for ${input.organizationLogin}`,
      request: () =>
        octokit.rest.orgs.listMembers({
          org: input.organizationLogin,
          per_page: GitHubPageSize,
          page,
        }),
    });
    const parsedResponse = z.array(GitHubCollaboratorSchema).parse(response.data);
    members.push(...parsedResponse);

    if (parsedResponse.length < GitHubPageSize) {
      return members;
    }
  }
}

async function listGitHubTeamMembers(input: {
  apiBaseUrl: string;
  token: string;
  organizationLogin: string;
  teamSlug: string;
}): Promise<ReadonlyArray<GitHubCollaborator>> {
  const octokit = createGitHubOctokit({
    apiBaseUrl: input.apiBaseUrl,
    token: input.token,
  });

  const members: GitHubCollaborator[] = [];
  for (let page = 1; ; page += 1) {
    const response = await runGitHubResourceRequest({
      operation: `team member listing for ${input.organizationLogin}/${input.teamSlug}`,
      request: () =>
        octokit.rest.teams.listMembersInOrg({
          org: input.organizationLogin,
          team_slug: input.teamSlug,
          per_page: GitHubPageSize,
          page,
        }),
    });
    const parsedResponse = z.array(GitHubCollaboratorSchema).parse(response.data);
    members.push(...parsedResponse);

    if (parsedResponse.length < GitHubPageSize) {
      return members;
    }
  }
}

async function listGitHubOrganizationInstallations(input: {
  apiBaseUrl: string;
  token: string;
  organizationLogin: string;
}): Promise<ReadonlyArray<GitHubOrganizationInstallation>> {
  const octokit = createGitHubOctokit({
    apiBaseUrl: input.apiBaseUrl,
    token: input.token,
  });

  const installations: GitHubOrganizationInstallation[] = [];
  for (let page = 1; ; page += 1) {
    const response = await runGitHubResourceRequest({
      operation: `organization installation listing for ${input.organizationLogin}`,
      request: () =>
        octokit.request("GET /orgs/{org}/installations", {
          org: input.organizationLogin,
          per_page: GitHubPageSize,
          page,
        }),
    });
    const parsedResponse = GitHubOrganizationInstallationsResponseSchema.parse(response.data);
    installations.push(...parsedResponse.installations);

    if (parsedResponse.installations.length < GitHubPageSize) {
      return installations;
    }
  }
}

async function mapRepositoriesWithConcurrency<T>(input: {
  repositories: readonly GitHubRepository[];
  concurrency: number;
  mapper: (repository: GitHubRepository) => Promise<readonly T[]>;
}): Promise<T[]> {
  const results: T[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < input.repositories.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const repository = input.repositories[currentIndex];
      if (repository === undefined) {
        continue;
      }

      results.push(...(await input.mapper(repository)));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(input.concurrency, input.repositories.length) }, () => worker()),
  );

  return results;
}

function dedupeResourcesByHandle(
  resources: readonly DiscoveredIntegrationResource[],
): DiscoveredIntegrationResource[] {
  const resourcesByHandle = new Map<string, DiscoveredIntegrationResource>();

  for (const resource of resources) {
    if (resourcesByHandle.has(resource.handle)) {
      continue;
    }

    resourcesByHandle.set(resource.handle, resource);
  }

  return Array.from(resourcesByHandle.values()).sort((left, right) =>
    left.handle.localeCompare(right.handle),
  );
}

function dedupeUserResourcesByExternalId(
  resources: readonly DiscoveredIntegrationResource[],
): DiscoveredIntegrationResource[] {
  const resourcesByExternalId = new Map<string, DiscoveredIntegrationResource>();

  for (const resource of resources) {
    if (resource.externalId === undefined) {
      throw new Error(`GitHub user resource '${resource.handle}' is missing an external id.`);
    }

    const existingResource = resourcesByExternalId.get(resource.externalId);
    if (existingResource === undefined || resource.handle < existingResource.handle) {
      resourcesByExternalId.set(resource.externalId, resource);
    }
  }

  return Array.from(resourcesByExternalId.values()).sort((left, right) =>
    left.handle.localeCompare(right.handle),
  );
}

function dedupeTeamResourcesByExternalId(
  resources: readonly DiscoveredIntegrationResource[],
): DiscoveredIntegrationResource[] {
  const resourcesByExternalId = new Map<string, DiscoveredIntegrationResource>();

  for (const resource of resources) {
    if (resource.externalId === undefined) {
      throw new Error(`GitHub team resource '${resource.handle}' is missing an external id.`);
    }

    const existingResource = resourcesByExternalId.get(resource.externalId);
    if (existingResource === undefined) {
      resourcesByExternalId.set(resource.externalId, resource);
      continue;
    }

    if (resource.handle < existingResource.handle) {
      resourcesByExternalId.set(resource.externalId, resource);
    }
  }

  return Array.from(resourcesByExternalId.values()).sort((left, right) =>
    left.handle.localeCompare(right.handle),
  );
}

function dedupeBotResourcesByExternalId(
  resources: readonly DiscoveredIntegrationResource[],
): DiscoveredIntegrationResource[] {
  const resourcesByExternalId = new Map<string, DiscoveredIntegrationResource>();

  for (const resource of resources) {
    if (resource.externalId === undefined) {
      throw new Error(`GitHub bot resource '${resource.handle}' is missing an external id.`);
    }

    const existingResource = resourcesByExternalId.get(resource.externalId);
    if (existingResource === undefined) {
      resourcesByExternalId.set(resource.externalId, resource);
      continue;
    }

    const organizationLogins = mergeSortedStringArrayMetadata(
      existingResource.metadata["organizationLogins"],
      resource.metadata["organizationLogins"],
    );
    const installationIds = mergeSortedStringArrayMetadata(
      existingResource.metadata["installationIds"],
      resource.metadata["installationIds"],
    );

    resourcesByExternalId.set(resource.externalId, {
      ...existingResource,
      metadata: {
        ...existingResource.metadata,
        organizationLogins,
        installationIds,
      },
    });
  }

  return Array.from(resourcesByExternalId.values()).sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

function mergeSortedStringArrayMetadata(left: unknown, right: unknown): string[] {
  return [...new Set([...parseStringArrayMetadata(left), ...parseStringArrayMetadata(right)])].sort(
    (leftItem, rightItem) => leftItem.localeCompare(rightItem),
  );
}

function parseStringArrayMetadata(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

async function listGitHubBranches(input: {
  apiBaseUrl: string;
  credential: string;
  repositories: readonly GitHubRepository[];
}): Promise<ReadonlyArray<DiscoveredIntegrationResource>> {
  const branches = await mapRepositoriesWithConcurrency({
    repositories: input.repositories,
    concurrency: 5,
    mapper: async (repository) =>
      (
        await listGitHubRepositoryBranches({
          apiBaseUrl: input.apiBaseUrl,
          token: input.credential,
          repository,
        })
      ).map((branch) =>
        toBranchResource({
          branch,
          repositoryFullName: repository.full_name,
        }),
      ),
  });

  return dedupeResourcesByHandle(branches);
}

async function listGitHubUsers(input: {
  apiBaseUrl: string;
  credential: string;
  repositories: readonly GitHubRepository[];
}): Promise<ReadonlyArray<DiscoveredIntegrationResource>> {
  const users = await mapRepositoriesWithConcurrency({
    repositories: input.repositories,
    concurrency: 5,
    mapper: async (repository) =>
      (
        await listGitHubRepositoryCollaborators({
          apiBaseUrl: input.apiBaseUrl,
          token: input.credential,
          repository,
        })
      )
        .filter((collaborator) => collaborator.type === "User")
        .map((collaborator) => toUserResource(collaborator)),
  });

  return dedupeUserResourcesByExternalId(users);
}

function listGitHubOrganizationLogins(
  repositories: readonly GitHubRepository[],
): ReadonlyArray<string> {
  const organizationLogins = new Set<string>();

  for (const repository of repositories) {
    if (repository.owner?.type !== "Organization") {
      continue;
    }

    organizationLogins.add(repository.owner.login);
  }

  return [...organizationLogins].sort((left, right) => left.localeCompare(right));
}

function listGitHubOrgs(
  repositories: readonly GitHubRepository[],
): ReadonlyArray<DiscoveredIntegrationResource> {
  const resourcesByExternalId = new Map<string, DiscoveredIntegrationResource>();

  for (const repository of repositories) {
    if (repository.owner?.type !== "Organization") {
      continue;
    }

    if (repository.owner.id === undefined) {
      throw new Error(
        `GitHub organization resource '${repository.owner.login}' is missing an external id.`,
      );
    }

    const externalId = repository.owner.id.toString();
    const resource = toOrgResource({
      id: externalId,
      login: repository.owner.login,
    });
    const existingResource = resourcesByExternalId.get(externalId);
    if (existingResource === undefined || resource.handle < existingResource.handle) {
      resourcesByExternalId.set(externalId, resource);
    }
  }

  return Array.from(resourcesByExternalId.values()).sort((left, right) =>
    left.handle.localeCompare(right.handle),
  );
}

async function listGitHubTeams(input: {
  apiBaseUrl: string;
  credential: string;
  repositories: readonly GitHubRepository[];
}): Promise<ReadonlyArray<DiscoveredIntegrationResource>> {
  const organizationLogins = listGitHubOrganizationLogins(input.repositories);
  const teamResources: DiscoveredIntegrationResource[] = [];

  for (const organizationLogin of organizationLogins) {
    const teams = await listGitHubOrganizationTeams({
      apiBaseUrl: input.apiBaseUrl,
      token: input.credential,
      organizationLogin,
    });

    teamResources.push(
      ...teams.map((team) =>
        toTeamResource({
          team,
          organizationLogin: team.organization?.login ?? organizationLogin,
        }),
      ),
    );
  }

  return dedupeTeamResourcesByExternalId(teamResources);
}

async function listGitHubBots(input: {
  apiBaseUrl: string;
  credential: string;
  repositories: readonly GitHubRepository[];
}): Promise<ReadonlyArray<DiscoveredIntegrationResource>> {
  const organizationLogins = listGitHubOrganizationLogins(input.repositories);
  const botResources: DiscoveredIntegrationResource[] = [];

  for (const organizationLogin of organizationLogins) {
    const installations = await listGitHubOrganizationInstallations({
      apiBaseUrl: input.apiBaseUrl,
      token: input.credential,
      organizationLogin,
    });

    botResources.push(
      ...installations.map((installation) =>
        toBotResource({
          installation,
          organizationLogin,
        }),
      ),
    );
  }

  return dedupeBotResourcesByExternalId(botResources);
}

async function listGitHubOrgMembershipRelationships(input: {
  apiBaseUrl: string;
  credential: string;
  scopeExternalId: string;
  scopeHandle: string;
}): Promise<ReadonlyArray<DiscoveredIntegrationResourceRelationship>> {
  const members = await listGitHubOrganizationMembers({
    apiBaseUrl: input.apiBaseUrl,
    token: input.credential,
    organizationLogin: input.scopeHandle,
  });

  return members
    .filter((member) => member.type === "User")
    .map((member) =>
      toOrgMembershipRelationship({
        member,
        orgExternalId: input.scopeExternalId,
        orgHandle: input.scopeHandle,
      }),
    )
    .sort((left, right) => left.subjectHandle.localeCompare(right.subjectHandle));
}

async function listGitHubTeamMembershipRelationships(input: {
  apiBaseUrl: string;
  credential: string;
  scopeExternalId: string;
  scopeHandle: string;
}): Promise<ReadonlyArray<DiscoveredIntegrationResourceRelationship>> {
  const { organizationLogin, teamSlug } = parseGitHubTeamScopeHandle(input.scopeHandle);
  const members = await listGitHubTeamMembers({
    apiBaseUrl: input.apiBaseUrl,
    token: input.credential,
    organizationLogin,
    teamSlug,
  });

  return members
    .filter((member) => member.type === "User")
    .map((member) =>
      toTeamMembershipRelationship({
        member,
        teamExternalId: input.scopeExternalId,
        teamHandle: input.scopeHandle,
      }),
    )
    .sort((left, right) => left.subjectHandle.localeCompare(right.subjectHandle));
}

export async function listGitHubConnectionResources(
  input: GitHubListConnectionResourcesInput,
): Promise<ListConnectionResourcesResult> {
  if (input.credential === undefined) {
    throw new Error(`GitHub ${input.kind} resource listing requires a resolved credential.`);
  }

  if (input.credential.kind !== "value") {
    throw new Error(`GitHub ${input.kind} resource listing requires a string credential value.`);
  }

  const parsedConnectionConfig = GitHubConnectionConfigSchema.parse(input.connection.config);
  const credential = input.credential.value;
  if (
    input.kind === GitHubUserKind &&
    parsedConnectionConfig.connection_method !==
      IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
  ) {
    throw new Error("GitHub user resource listing requires a GitHub App installation connection.");
  }

  const repositories = await listGitHubRepositories({
    apiBaseUrl: input.target.config.apiBaseUrl,
    credential,
    connectionConfig: parsedConnectionConfig,
  });

  if (input.kind === GitHubRepositoryKind) {
    return {
      resources: repositories
        .map((repository) => toDiscoveredResource(repository))
        .sort((left, right) => left.handle.localeCompare(right.handle)),
    };
  }

  if (input.kind === GitHubBranchKind) {
    return {
      resources: await listGitHubBranches({
        apiBaseUrl: input.target.config.apiBaseUrl,
        credential,
        repositories,
      }),
    };
  }

  if (input.kind === GitHubUserKind) {
    return {
      resources: await listGitHubUsers({
        apiBaseUrl: input.target.config.apiBaseUrl,
        credential,
        repositories,
      }),
    };
  }

  if (input.kind === GitHubOrgKind) {
    const resources = listGitHubOrgs(repositories);
    const relationshipLists = await Promise.all(
      resources.map((resource) => {
        if (resource.externalId === undefined) {
          throw new Error(`GitHub org resource '${resource.handle}' is missing an external id.`);
        }

        return listGitHubOrgMembershipRelationships({
          apiBaseUrl: input.target.config.apiBaseUrl,
          credential,
          scopeExternalId: resource.externalId,
          scopeHandle: resource.handle,
        });
      }),
    );

    return {
      resources,
      relationships: relationshipLists.flat(),
    };
  }

  if (input.kind === GitHubTeamKind) {
    const resources = await listGitHubTeams({
      apiBaseUrl: input.target.config.apiBaseUrl,
      credential,
      repositories,
    });
    const relationshipLists = await Promise.all(
      resources.map((resource) => {
        if (resource.externalId === undefined) {
          throw new Error(`GitHub team resource '${resource.handle}' is missing an external id.`);
        }

        return listGitHubTeamMembershipRelationships({
          apiBaseUrl: input.target.config.apiBaseUrl,
          credential,
          scopeExternalId: resource.externalId,
          scopeHandle: resource.handle,
        });
      }),
    );

    return {
      resources,
      relationships: relationshipLists.flat(),
    };
  }

  if (input.kind === GitHubBotKind) {
    return {
      resources: await listGitHubBots({
        apiBaseUrl: input.target.config.apiBaseUrl,
        credential,
        repositories,
      }),
    };
  }

  throw new Error(`Unsupported GitHub resource kind '${input.kind}'.`);
}
