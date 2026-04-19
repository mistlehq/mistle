import type {
  EgressCredentialResolverRef,
  IntegrationEgressCredentialResolverSelectionInput,
} from "@mistle/integrations-core";

import { GitHubFamilyId } from "./constants.js";

const GitHubLinkedUserCredentialKind = "github_app_user_access_token";
const GraphQLPullRequestMutationPattern = /\b(createPullRequest|updatePullRequest)\b/;

function isPullRequestCreateRequest(input: { method: string; pathname: string }): boolean {
  return input.method === "POST" && /\/repos\/[^/]+\/[^/]+\/pulls$/.test(input.pathname);
}

function isPullRequestUpdateRequest(input: { method: string; pathname: string }): boolean {
  return input.method === "PATCH" && /\/repos\/[^/]+\/[^/]+\/pulls\/[^/]+$/.test(input.pathname);
}

function isGitReceivePackDiscoveryRequest(input: {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
}): boolean {
  return (
    input.method === "GET" &&
    /\/[^/]+\/[^/]+\.git\/info\/refs$/.test(input.pathname) &&
    input.searchParams.get("service") === "git-receive-pack"
  );
}

function isGitReceivePackRequest(input: { method: string; pathname: string }): boolean {
  return input.method === "POST" && /\/[^/]+\/[^/]+\.git\/git-receive-pack$/.test(input.pathname);
}

function decodeRequestBody(body: Uint8Array | undefined): string | undefined {
  if (body === undefined || body.byteLength === 0) {
    return undefined;
  }

  return new TextDecoder().decode(body);
}

function isGraphQLPullRequestMutationRequest(input: {
  method: string;
  pathname: string;
  body: Uint8Array | undefined;
}): boolean {
  if (input.method !== "POST" || input.pathname !== "/graphql") {
    return false;
  }

  const requestBody = decodeRequestBody(input.body);
  if (requestBody === undefined) {
    return false;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(requestBody);
  } catch {
    return false;
  }

  if (typeof parsedBody !== "object" || parsedBody === null) {
    return false;
  }

  const operationName =
    "operationName" in parsedBody && typeof parsedBody.operationName === "string"
      ? parsedBody.operationName
      : undefined;
  if (operationName === "CreatePullRequest" || operationName === "UpdatePullRequest") {
    return true;
  }

  const query =
    "query" in parsedBody && typeof parsedBody.query === "string" ? parsedBody.query : undefined;
  if (query === undefined) {
    return false;
  }

  return GraphQLPullRequestMutationPattern.test(query);
}

export function shouldUseGitHubLinkedPrincipalCredential(input: {
  request: { method: string; url: URL; body?: Uint8Array | undefined };
}): boolean {
  const normalizedMethod = input.request.method.trim().toUpperCase();
  const requestShape = {
    method: normalizedMethod,
    pathname: input.request.url.pathname,
  };

  return (
    isPullRequestCreateRequest(requestShape) ||
    isPullRequestUpdateRequest(requestShape) ||
    isGitReceivePackDiscoveryRequest({
      ...requestShape,
      searchParams: input.request.url.searchParams,
    }) ||
    isGitReceivePackRequest(requestShape) ||
    isGraphQLPullRequestMutationRequest({
      ...requestShape,
      body: input.request.body,
    })
  );
}

export function resolveGitHubUserAttributedEgressCredentialResolver(
  input: IntegrationEgressCredentialResolverSelectionInput,
): EgressCredentialResolverRef {
  if (input.defaultCredentialResolver.kind !== "integration_connection") {
    return input.defaultCredentialResolver;
  }

  if (!shouldUseGitHubLinkedPrincipalCredential({ request: input.request })) {
    return input.defaultCredentialResolver;
  }

  return {
    kind: "linked_principal",
    providerFamily: GitHubFamilyId,
    credentialKind: GitHubLinkedUserCredentialKind,
    actingUserRequired: true,
    resolutionMode: "preferred",
  };
}
