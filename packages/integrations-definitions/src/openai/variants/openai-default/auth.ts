import { IntegrationSupportedAuthSchemes } from "@mistle/integrations-core";
import { z } from "zod";

import { OpenAiConnectionAuthSchemes } from "./model-capabilities.js";

export const OpenAiApiKeyCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const OpenAiApiKeySupportedAuthSchemes = [
  IntegrationSupportedAuthSchemes.API_KEY,
  IntegrationSupportedAuthSchemes.OAUTH,
] as const;

export const OpenAiConnectionConfigSchema = z.looseObject({
  auth_scheme: z.enum([OpenAiConnectionAuthSchemes.API_KEY, OpenAiConnectionAuthSchemes.OAUTH]),
});

export type OpenAiConnectionConfig = z.output<typeof OpenAiConnectionConfigSchema>;

export function resolveOpenAiCredentialSecretType(input: unknown): "api_key" {
  const parsedConnectionConfig = OpenAiConnectionConfigSchema.parse(input);

  if (
    parsedConnectionConfig.auth_scheme === IntegrationSupportedAuthSchemes.API_KEY ||
    parsedConnectionConfig.auth_scheme === IntegrationSupportedAuthSchemes.OAUTH
  ) {
    return OpenAiApiKeyCredentialSecretTypes.API_KEY;
  }

  throw new Error(`Unsupported OpenAI auth scheme '${parsedConnectionConfig.auth_scheme}'.`);
}
