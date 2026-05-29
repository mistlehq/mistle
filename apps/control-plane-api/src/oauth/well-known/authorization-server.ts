import { OAuthGrantTypes } from "@mistle/db/control-plane";

import { MistleCliOAuthClient } from "../clients.js";
import { McpOAuthScopes } from "./protected-resource.js";

export const OAuthAuthorizationServerScopesSupported = [
  ...new Set([...MistleCliOAuthClient.scopes, ...McpOAuthScopes]),
].sort();

export type OAuthAuthorizationServerMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  response_types_supported: ["code"];
  grant_types_supported: [
    typeof OAuthGrantTypes.AUTHORIZATION_CODE,
    typeof OAuthGrantTypes.REFRESH_TOKEN,
  ];
  code_challenge_methods_supported: ["S256"];
  token_endpoint_auth_methods_supported: ["none"];
  scopes_supported: typeof OAuthAuthorizationServerScopesSupported;
};

export function createOAuthAuthorizationServerMetadata(input: {
  issuer: string;
}): OAuthAuthorizationServerMetadata {
  return {
    issuer: input.issuer,
    authorization_endpoint: new URL("/oauth/authorize", input.issuer).toString(),
    token_endpoint: new URL("/oauth/token", input.issuer).toString(),
    registration_endpoint: new URL("/oauth/register", input.issuer).toString(),
    response_types_supported: ["code"],
    grant_types_supported: [OAuthGrantTypes.AUTHORIZATION_CODE, OAuthGrantTypes.REFRESH_TOKEN],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: OAuthAuthorizationServerScopesSupported,
  };
}
