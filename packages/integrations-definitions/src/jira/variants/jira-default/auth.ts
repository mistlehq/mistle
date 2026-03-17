import { IntegrationSupportedAuthSchemes } from "@mistle/integrations-core";
import { z } from "zod";

export const JiraCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const JiraSupportedAuthSchemes = [IntegrationSupportedAuthSchemes.API_KEY] as const;

export const JiraConnectionConfigSchema = z
  .object({
    auth_scheme: z.literal(IntegrationSupportedAuthSchemes.API_KEY),
  })
  .loose();

export type JiraConnectionConfig = z.output<typeof JiraConnectionConfigSchema>;

export function resolveJiraCredentialSecretType(input: unknown): "api_key" {
  const parsedConnectionConfig = JiraConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.auth_scheme === IntegrationSupportedAuthSchemes.API_KEY) {
    return JiraCredentialSecretTypes.API_KEY;
  }

  throw new Error(`Unsupported Jira auth scheme '${parsedConnectionConfig.auth_scheme}'.`);
}
