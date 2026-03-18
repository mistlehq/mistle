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
  default_branch: z.string().min(1).optional().nullable(),
  visibility: z.string().min(1).optional(),
  archived: z.boolean().optional(),
  private: z.boolean().optional(),
});

const GitHubInstallationRepositoriesResponseSchema = z.looseObject({
  repositories: z.array(GitHubRepositorySchema),
});

const GitHubUserRepositoriesResponseSchema = z.array(GitHubRepositorySchema);

type GitHubRepository = z.output<typeof GitHubRepositorySchema>;

type GitHubListConnectionResourcesInput = ListConnectionResourcesInput<
  GitHubTargetConfig,
  GitHubTargetSecrets,
  GitHubConnectionConfig
>;

const GitHubApiVersion = "2022-11-28";
const GitHubRepositoryKind = "repository";
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

export async function listGitHubConnectionResources(
  input: GitHubListConnectionResourcesInput,
): Promise<ListConnectionResourcesResult> {
  if (input.kind !== GitHubRepositoryKind) {
    throw new Error(`Unsupported GitHub resource kind '${input.kind}'.`);
  }

  if (input.credential === undefined) {
    throw new Error("GitHub repository resource listing requires a resolved credential.");
  }

  const parsedConnectionConfig = GitHubConnectionConfigSchema.parse(input.connection.config);
  const repositories = await listGitHubRepositories({
    apiBaseUrl: input.target.config.apiBaseUrl,
    credential: input.credential.value,
    connectionConfig: parsedConnectionConfig,
  });

  return {
    resources: repositories
      .map((repository) => toDiscoveredResource(repository))
      .sort((left, right) => left.handle.localeCompare(right.handle)),
  };
}
