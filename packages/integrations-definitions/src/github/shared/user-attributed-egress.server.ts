import type {
  EgressCredentialResolverRef,
  IntegrationEgressCredentialResolverSelectionInput,
} from "@mistle/integrations-core";

import { GitHubFamilyId } from "./constants.js";

const GitHubLinkedUserCredentialKind = "github_app_user_access_token";

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

export function shouldUseGitHubLinkedPrincipalCredential(input: {
  request: { method: string; url: URL };
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
    isGitReceivePackRequest(requestShape)
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
