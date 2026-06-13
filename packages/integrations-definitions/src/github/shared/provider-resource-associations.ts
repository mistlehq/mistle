import { AssociatedProviderResourceKinds } from "@mistle/integrations-core";
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
const GitHubGraphqlPullRequestCreationUrlResponseSchema = z.looseObject({
  data: z.looseObject({
    createPullRequest: z.looseObject({
      pullRequest: z.looseObject({
        url: z.url(),
      }),
    }),
  }),
});

const GitHubGraphqlCreatePullRequestPattern = /\bcreatePullRequest\b/;

export type GitHubPullRequestProviderResourceExtractionMethod =
  | "github_rest_pull_request_fields"
  | "github_graphql_pull_request_fields"
  | "github_graphql_pull_request_url";

export type GitHubRoutableResourceObservation = {
  extractionMethod: GitHubPullRequestProviderResourceExtractionMethod;
  resourceKind: "github.pull_request";
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
  // REST pull request creation returns stable structured fields for the
  // routable key: `number` and `base.repo.full_name`.
  const parsedBody = GitHubPullRequestCreationResponseSchema.safeParse(responseBody);
  if (!parsedBody.success) {
    return null;
  }

  return createPullRequestObservation({
    extractionMethod: "github_rest_pull_request_fields",
    repositoryFullName: parsedBody.data.base.repo.full_name,
    pullRequestNumber: parsedBody.data.number,
  });
}

function observeGraphqlPullRequestCreationResponse(
  responseBody: unknown,
): GitHubRoutableResourceObservation | null {
  // GraphQL responses only include fields selected by the caller. This shape is
  // ideal when the caller selected structured PR identity fields directly.
  const parsedBody = GitHubGraphqlPullRequestCreationResponseSchema.safeParse(responseBody);
  if (parsedBody.success) {
    return createPullRequestObservation({
      extractionMethod: "github_graphql_pull_request_fields",
      repositoryFullName:
        parsedBody.data.data.createPullRequest.pullRequest.repository.nameWithOwner,
      pullRequestNumber: parsedBody.data.data.createPullRequest.pullRequest.number,
    });
  }

  // The currently observed `gh pr create` GraphQL response selects only
  // `pullRequest.id` and `pullRequest.url`, so URL parsing is the active path
  // for that client while still producing the same canonical `owner/repo#number`
  // provider resource id used by webhook association delivery.
  const parsedUrlBody = GitHubGraphqlPullRequestCreationUrlResponseSchema.safeParse(responseBody);
  if (!parsedUrlBody.success) {
    return null;
  }

  const pullRequestResource = parseGitHubPullRequestUrl(
    parsedUrlBody.data.data.createPullRequest.pullRequest.url,
  );
  if (pullRequestResource === null) {
    return null;
  }

  return createPullRequestObservation({
    extractionMethod: "github_graphql_pull_request_url",
    ...pullRequestResource,
  });
}

export function createGitHubPullRequestProviderResourceId(input: {
  pullRequestNumber: number;
  repositoryFullName: string;
}): string {
  return `${input.repositoryFullName}#${String(input.pullRequestNumber)}`;
}

function createPullRequestObservation(input: {
  extractionMethod: GitHubPullRequestProviderResourceExtractionMethod;
  pullRequestNumber: number;
  repositoryFullName: string;
}): GitHubRoutableResourceObservation {
  return {
    extractionMethod: input.extractionMethod,
    resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
    providerResourceId: createGitHubPullRequestProviderResourceId(input),
  };
}

function parseGitHubPullRequestUrl(url: string): {
  pullRequestNumber: number;
  repositoryFullName: string;
} | null {
  const parsedUrl = new URL(url);
  const segments = parsedUrl.pathname.split("/").filter(Boolean);
  if (segments.length !== 4 || segments[2] !== "pull") {
    return null;
  }

  const [owner, repo, , pullRequestNumberText] = segments;
  if (owner === undefined || repo === undefined || pullRequestNumberText === undefined) {
    return null;
  }

  const pullRequestNumber = Number(pullRequestNumberText);
  if (!Number.isInteger(pullRequestNumber) || pullRequestNumber <= 0) {
    return null;
  }

  return {
    repositoryFullName: `${owner}/${repo}`,
    pullRequestNumber,
  };
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
