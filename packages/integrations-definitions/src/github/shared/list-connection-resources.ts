import {
  IntegrationConnectionMethodIds,
  type DiscoveredIntegrationResource,
  type ListConnectionResourcesInput,
  type ListConnectionResourcesResult,
} from "@mistle/integrations-core";
import { Octokit } from "octokit";
import { z } from "zod";

import { GitHubConnectionConfigSchema, type GitHubConnectionConfig } from "./auth.js";
import type { GitHubTargetConfig } from "./target-config-schema.js";
import type { GitHubTargetSecrets } from "./target-secret-schema.js";

const GitHubRepositorySchema = z.looseObject({
  id: z.union([z.string().min(1), z.number().int()]),
  full_name: z.string().min(1),
  owner: z
    .looseObject({
      login: z.string().min(1),
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

const GitHubContributorSchema = z.looseObject({
  id: z.union([z.string().min(1), z.number().int()]),
  login: z.string().min(1),
  type: z.string().min(1).optional(),
});

const GitHubInstallationRepositoriesResponseSchema = z.looseObject({
  repositories: z.array(GitHubRepositorySchema),
});

const GitHubUserRepositoriesResponseSchema = z.array(GitHubRepositorySchema);

type GitHubRepository = z.output<typeof GitHubRepositorySchema>;
type GitHubBranch = z.output<typeof GitHubBranchSchema>;
type GitHubContributor = z.output<typeof GitHubContributorSchema>;

type GitHubListConnectionResourcesInput = ListConnectionResourcesInput<
  GitHubTargetConfig,
  GitHubTargetSecrets,
  GitHubConnectionConfig
>;

const GitHubApiVersion = "2022-11-28";
const GitHubRepositoryKind = "repository";
const GitHubBranchKind = "branch";
const GitHubUserKind = "user";
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

function toUserResource(input: {
  contributor: GitHubContributor;
  repositoryFullName: string;
}): DiscoveredIntegrationResource {
  return {
    externalId: input.contributor.id.toString(),
    handle: input.contributor.login,
    displayName: input.contributor.login,
    metadata: {
      repositoryFullName: input.repositoryFullName,
      type: input.contributor.type ?? "User",
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
    const response = await octokit.rest.apps.listReposAccessibleToInstallation({
      per_page: GitHubPageSize,
      page,
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
    const response = await octokit.rest.repos.listForAuthenticatedUser({
      affiliation: "owner,collaborator,organization_member",
      sort: "full_name",
      per_page: GitHubPageSize,
      page,
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
    const response = await octokit.rest.repos.listBranches({
      owner,
      repo,
      per_page: GitHubPageSize,
      page,
    });
    const parsedResponse = z.array(GitHubBranchSchema).parse(response.data);
    branches.push(...parsedResponse);

    if (parsedResponse.length < GitHubPageSize) {
      return branches;
    }
  }
}

async function listGitHubRepositoryContributors(input: {
  apiBaseUrl: string;
  token: string;
  repository: GitHubRepository;
}): Promise<ReadonlyArray<GitHubContributor>> {
  const octokit = createGitHubOctokit({
    apiBaseUrl: input.apiBaseUrl,
    token: input.token,
  });
  const [owner, repo] = input.repository.full_name.split("/");
  if (owner === undefined || repo === undefined) {
    return [];
  }

  const contributors: GitHubContributor[] = [];
  for (let page = 1; ; page += 1) {
    const response = await octokit.rest.repos.listContributors({
      owner,
      repo,
      per_page: GitHubPageSize,
      page,
    });
    const parsedResponse = z.array(GitHubContributorSchema).parse(response.data);
    contributors.push(...parsedResponse);

    if (parsedResponse.length < GitHubPageSize) {
      return contributors;
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
        await listGitHubRepositoryContributors({
          apiBaseUrl: input.apiBaseUrl,
          token: input.credential,
          repository,
        })
      ).map((contributor) =>
        toUserResource({
          contributor,
          repositoryFullName: repository.full_name,
        }),
      ),
  });

  return dedupeResourcesByHandle(users);
}

export async function listGitHubConnectionResources(
  input: GitHubListConnectionResourcesInput,
): Promise<ListConnectionResourcesResult> {
  if (input.credential === undefined) {
    throw new Error(`GitHub ${input.kind} resource listing requires a resolved credential.`);
  }

  const parsedConnectionConfig = GitHubConnectionConfigSchema.parse(input.connection.config);
  const repositories = await listGitHubRepositories({
    apiBaseUrl: input.target.config.apiBaseUrl,
    credential: input.credential.value,
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
        credential: input.credential.value,
        repositories,
      }),
    };
  }

  if (input.kind === GitHubUserKind) {
    return {
      resources: await listGitHubUsers({
        apiBaseUrl: input.target.config.apiBaseUrl,
        credential: input.credential.value,
        repositories,
      }),
    };
  }

  throw new Error(`Unsupported GitHub resource kind '${input.kind}'.`);
}
