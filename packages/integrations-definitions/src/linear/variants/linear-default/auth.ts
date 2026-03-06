import { IntegrationSupportedAuthSchemes } from "@mistle/integrations-core";
import { z } from "zod";

export const LinearCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const LinearSupportedAuthSchemes = [IntegrationSupportedAuthSchemes.API_KEY] as const;

export const LinearConnectionConfigSchema = z
  .object({
    auth_scheme: z.literal(IntegrationSupportedAuthSchemes.API_KEY),
  })
  .loose();

export type LinearConnectionConfig = z.output<typeof LinearConnectionConfigSchema>;

export function resolveLinearCredentialSecretType(input: unknown): "api_key" {
  const parsedConnectionConfig = LinearConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.auth_scheme === IntegrationSupportedAuthSchemes.API_KEY) {
    return LinearCredentialSecretTypes.API_KEY;
  }

  throw new Error(`Unsupported Linear auth scheme '${parsedConnectionConfig.auth_scheme}'.`);
}
