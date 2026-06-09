import {
  AssociatedProviderResourceKinds,
  type AssociatedProviderResourceKind,
} from "@mistle/integrations-core";
import { z } from "zod";

const GitHubPullRequestCreationResponseSchema = z.looseObject({
  number: z.number().int().positive(),
  base: z.looseObject({
    repo: z.looseObject({
      full_name: z.string().min(1),
    }),
  }),
});
const GitHubGraphqlPullRequestCreationResponseSchema = z.looseObject({
  data: z.looseObject({
    createPullRequest: z.looseObject({
      pullRequest: z.looseObject({
        number: z.number().int().positive(),
        repository: z.looseObject({
          nameWithOwner: z.string().min(1),
        }),
      }),
    }),
  }),
});

const GitHubGraphqlCreatePullRequestPattern = /\bcreatePullRequest\b/;

export type GitHubRoutableResourceObservation = {
  resourceKind: Extract<AssociatedProviderResourceKind, "github.pull_request">;
  providerResourceId: string;
};

export function observeGitHubRoutableResourceFromEgressResponse(input: {
  method: string;
  path: string;
  requestBody?: Uint8Array | undefined;
  responseBody: unknown;
  status: number;
}): GitHubRoutableResourceObservation | null {
  if (!isSuccessfulResponse(input.status)) {
    return null;
  }

  if (isGitHubRestPullRequestCreationRequest(input)) {
    return observeRestPullRequestCreationResponse(input.responseBody);
  }

  if (isGitHubGraphqlPullRequestCreationRequest(input)) {
    return observeGraphqlPullRequestCreationResponse(input.responseBody);
  }

  return null;
}

function observeRestPullRequestCreationResponse(
  responseBody: unknown,
): GitHubRoutableResourceObservation | null {
  const parsedBody = GitHubPullRequestCreationResponseSchema.safeParse(responseBody);
  if (!parsedBody.success) {
    return null;
  }

  return {
    resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
    providerResourceId: createGitHubPullRequestProviderResourceId({
      repositoryFullName: parsedBody.data.base.repo.full_name,
      pullRequestNumber: parsedBody.data.number,
    }),
  };
}

function observeGraphqlPullRequestCreationResponse(
  responseBody: unknown,
): GitHubRoutableResourceObservation | null {
  const parsedBody = GitHubGraphqlPullRequestCreationResponseSchema.safeParse(responseBody);
  if (!parsedBody.success) {
    return null;
  }

  return {
    resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
    providerResourceId: createGitHubPullRequestProviderResourceId({
      repositoryFullName:
        parsedBody.data.data.createPullRequest.pullRequest.repository.nameWithOwner,
      pullRequestNumber: parsedBody.data.data.createPullRequest.pullRequest.number,
    }),
  };
}

export function createGitHubPullRequestProviderResourceId(input: {
  pullRequestNumber: number;
  repositoryFullName: string;
}): string {
  return `${input.repositoryFullName}#${String(input.pullRequestNumber)}`;
}

export function isGitHubPullRequestCreationRequest(input: {
  method: string;
  path: string;
  requestBody?: Uint8Array | undefined;
}): boolean {
  return (
    isGitHubRestPullRequestCreationRequest(input) ||
    isGitHubGraphqlPullRequestCreationRequest(input)
  );
}

function isSuccessfulResponse(status: number): boolean {
  return status >= 200 && status < 300;
}

function isGitHubRestPullRequestCreationRequest(input: { method: string; path: string }): boolean {
  return input.method.toUpperCase() === "POST" && isGitHubPullRequestCreationPath(input.path);
}

function isGitHubPullRequestCreationPath(path: string): boolean {
  const segments = path.split("?")[0]?.split("/").filter(Boolean) ?? [];
  return (
    segments.length >= 4 &&
    segments[segments.length - 4] === "repos" &&
    segments[segments.length - 3] !== undefined &&
    segments[segments.length - 2] !== undefined &&
    segments[segments.length - 1] === "pulls"
  );
}

function isGitHubGraphqlPullRequestCreationRequest(input: {
  method: string;
  path: string;
  requestBody?: Uint8Array | undefined;
}): boolean {
  if (input.method.toUpperCase() !== "POST" || !input.path.endsWith("/graphql")) {
    return false;
  }

  const parsedBody = parseJsonRequestBody(input.requestBody);
  if (typeof parsedBody !== "object" || parsedBody === null || Array.isArray(parsedBody)) {
    return false;
  }

  const operationName =
    "operationName" in parsedBody && typeof parsedBody.operationName === "string"
      ? parsedBody.operationName
      : undefined;
  if (operationName === "CreatePullRequest") {
    return true;
  }

  const query =
    "query" in parsedBody && typeof parsedBody.query === "string" ? parsedBody.query : undefined;
  return query !== undefined && GitHubGraphqlCreatePullRequestPattern.test(query);
}

function parseJsonRequestBody(body: Uint8Array | undefined): unknown {
  if (body === undefined || body.byteLength === 0) {
    return null;
  }

  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
}
