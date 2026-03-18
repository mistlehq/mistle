import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const GitHubCredentialSecretTypes: {
  API_KEY: "api_key";
  GITHUB_APP_INSTALLATION_TOKEN: "github_app_installation_token";
} = {
  API_KEY: "api_key",
  GITHUB_APP_INSTALLATION_TOKEN: "github_app_installation_token",
};

export const GitHubApiKeyConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .loose();

export const GitHubAppInstallationConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION),
    installation_id: z.union([z.string().min(1), z.number().int().nonnegative()]),
    setup_action: z.string().min(1).optional(),
  })
  .loose();

export const GitHubConnectionConfigSchema = z.union([
  GitHubApiKeyConnectionConfigSchema,
  GitHubAppInstallationConnectionConfigSchema,
]);

export type GitHubConnectionConfig = z.output<typeof GitHubConnectionConfigSchema>;
export type GitHubCredentialSecretType =
  (typeof GitHubCredentialSecretTypes)[keyof typeof GitHubCredentialSecretTypes];

export function resolveGitHubCredentialSecretType(input: unknown): GitHubCredentialSecretType {
  const parsedConnectionConfig = GitHubConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.connection_method === IntegrationConnectionMethodIds.API_KEY) {
    return GitHubCredentialSecretTypes.API_KEY;
  }

  return GitHubCredentialSecretTypes.GITHUB_APP_INSTALLATION_TOKEN;
}
