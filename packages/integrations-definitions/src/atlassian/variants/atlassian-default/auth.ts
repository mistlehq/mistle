import { IntegrationSupportedAuthSchemes } from "@mistle/integrations-core";
import { z } from "zod";

export const AtlassianCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const AtlassianSupportedAuthSchemes = [IntegrationSupportedAuthSchemes.API_KEY] as const;

export const AtlassianConnectionConfigSchema = z
  .object({
    auth_scheme: z.literal(IntegrationSupportedAuthSchemes.API_KEY),
  })
  .loose();

export type AtlassianConnectionConfig = z.output<typeof AtlassianConnectionConfigSchema>;

export function resolveAtlassianCredentialSecretType(input: unknown): "api_key" {
  const parsedConnectionConfig = AtlassianConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.auth_scheme === IntegrationSupportedAuthSchemes.API_KEY) {
    return AtlassianCredentialSecretTypes.API_KEY;
  }

  throw new Error(`Unsupported Atlassian auth scheme '${parsedConnectionConfig.auth_scheme}'.`);
}
