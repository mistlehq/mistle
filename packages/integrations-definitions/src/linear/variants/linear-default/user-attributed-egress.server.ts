import type {
  EgressCredentialResolverRef,
  IntegrationEgressCredentialResolverSelectionInput,
} from "@mistle/integrations-core";

import { LinearFamilyId } from "./auth.js";

const LinearLinkedUserCredentialKind = "linear_oauth_user_token";

function isLinearGraphqlRequest(input: { method: string; pathname: string }): boolean {
  return (
    input.method === "POST" &&
    (input.pathname === "/graphql" || input.pathname.startsWith("/graphql/"))
  );
}

function isLinearMcpRequest(input: { method: string; pathname: string }): boolean {
  return (
    input.method === "POST" && (input.pathname === "/mcp" || input.pathname.startsWith("/mcp/"))
  );
}

export function shouldUseLinearLinkedPrincipalCredential(input: {
  request: { method: string; url: URL };
}): boolean {
  const requestShape = {
    method: input.request.method.trim().toUpperCase(),
    pathname: input.request.url.pathname,
  };

  return isLinearGraphqlRequest(requestShape) || isLinearMcpRequest(requestShape);
}

export function resolveLinearUserAttributedEgressCredentialResolver(
  input: IntegrationEgressCredentialResolverSelectionInput,
): EgressCredentialResolverRef {
  if (input.defaultCredentialResolver.kind !== "integration_connection") {
    return input.defaultCredentialResolver;
  }

  if (!shouldUseLinearLinkedPrincipalCredential({ request: input.request })) {
    return input.defaultCredentialResolver;
  }

  return {
    kind: "linked_principal",
    providerFamily: LinearFamilyId,
    credentialKind: LinearLinkedUserCredentialKind,
    actingUserRequired: true,
    resolutionMode: "preferred",
  };
}
