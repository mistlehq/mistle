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

const GitHubAppInstallationConnectionConfigInputSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION),
    app_id: z.union([z.string().min(1), z.number().int().nonnegative()]),
    app_slug: z.string().min(1),
    client_id: z.string().min(1).optional(),
    installation_id: z.union([z.string().min(1), z.number().int().nonnegative()]).optional(),
    setup_action: z.string().min(1).optional(),
  })
  .strict();

export const GitHubAppInstallationConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION),
    app_id: z.string().min(1),
    app_slug: z.string().min(1),
    client_id: z.string().min(1).optional(),
    installation_id: z.string().min(1).optional(),
    setup_action: z.string().min(1).optional(),
  })
  .strict();

export const GitHubConnectionConfigSchema = z.union([
  GitHubApiKeyConnectionConfigSchema,
  GitHubAppInstallationConnectionConfigSchema,
]);

export type GitHubConnectionConfig = z.output<typeof GitHubConnectionConfigSchema>;
export type GitHubCredentialSecretType =
  (typeof GitHubCredentialSecretTypes)[keyof typeof GitHubCredentialSecretTypes];

export function parseGitHubAppInstallationConnectionConfig(
  input: unknown,
): z.output<typeof GitHubAppInstallationConnectionConfigSchema> {
  const parsedInput = GitHubAppInstallationConnectionConfigInputSchema.parse(input);

  return {
    connection_method: parsedInput.connection_method,
    app_id: parsedInput.app_id.toString(),
    app_slug: parsedInput.app_slug,
    ...(parsedInput.client_id === undefined ? {} : { client_id: parsedInput.client_id }),
    ...(parsedInput.installation_id === undefined
      ? {}
      : { installation_id: parsedInput.installation_id.toString() }),
    ...(parsedInput.setup_action === undefined ? {} : { setup_action: parsedInput.setup_action }),
  };
}

export function parseGitHubConnectionConfig(input: unknown): GitHubConnectionConfig {
  const parsedConnectionMethod = z
    .object({
      connection_method: z.string().min(1),
    })
    .loose()
    .parse(input);

  if (parsedConnectionMethod.connection_method === IntegrationConnectionMethodIds.API_KEY) {
    return GitHubApiKeyConnectionConfigSchema.parse(input);
  }

  return parseGitHubAppInstallationConnectionConfig(input);
}

export function resolveGitHubCredentialSecretType(input: unknown): GitHubCredentialSecretType {
  const parsedConnectionConfig = parseGitHubConnectionConfig(input);

  if (parsedConnectionConfig.connection_method === IntegrationConnectionMethodIds.API_KEY) {
    return GitHubCredentialSecretTypes.API_KEY;
  }

  return GitHubCredentialSecretTypes.GITHUB_APP_INSTALLATION_TOKEN;
}
