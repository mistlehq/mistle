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
    app_id: z.union([z.string().min(1), z.number().int().nonnegative()]),
    app_slug: z.string().min(1),
    installation_id: z.union([z.string().min(1), z.number().int().nonnegative()]).optional(),
    setup_action: z.string().min(1).optional(),
  })
  .strict()
  .transform((input) => ({
    connection_method: input.connection_method,
    app_id: input.app_id.toString(),
    app_slug: input.app_slug,
    ...(input.installation_id === undefined
      ? {}
      : { installation_id: input.installation_id.toString() }),
    ...(input.setup_action === undefined ? {} : { setup_action: input.setup_action }),
  }));

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
