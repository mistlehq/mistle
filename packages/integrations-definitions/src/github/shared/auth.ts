import { IntegrationSupportedAuthSchemes } from "@mistle/integrations-core";
import { z } from "zod";

export const GitHubCredentialSecretTypes: {
  API_KEY: "api_key";
  OAUTH_ACCESS_TOKEN: "oauth_access_token";
} = {
  API_KEY: "api_key",
  OAUTH_ACCESS_TOKEN: "oauth_access_token",
};

export const GitHubSupportedAuthSchemes = [
  IntegrationSupportedAuthSchemes.API_KEY,
  IntegrationSupportedAuthSchemes.OAUTH,
];

const GitHubApiKeyConnectionConfigSchema = z.looseObject({
  auth_scheme: z.literal(IntegrationSupportedAuthSchemes.API_KEY),
});

const GitHubOAuthConnectionConfigSchema = z.looseObject({
  auth_scheme: z.literal(IntegrationSupportedAuthSchemes.OAUTH),
  installation_id: z.union([z.string().min(1), z.number().int().nonnegative()]),
});

export const GitHubConnectionConfigSchema = z.union([
  GitHubApiKeyConnectionConfigSchema,
  GitHubOAuthConnectionConfigSchema,
]);

export type GitHubConnectionConfig = z.output<typeof GitHubConnectionConfigSchema>;
export type GitHubCredentialSecretType =
  (typeof GitHubCredentialSecretTypes)[keyof typeof GitHubCredentialSecretTypes];

export function resolveGitHubCredentialSecretType(input: unknown): GitHubCredentialSecretType {
  const parsedConnectionConfig = GitHubConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.auth_scheme === IntegrationSupportedAuthSchemes.API_KEY) {
    return GitHubCredentialSecretTypes.API_KEY;
  }

  return GitHubCredentialSecretTypes.OAUTH_ACCESS_TOKEN;
}
