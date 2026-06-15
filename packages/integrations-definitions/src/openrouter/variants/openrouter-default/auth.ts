import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const OpenRouterCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const OpenRouterCredentialSlotKeys: {
  API_KEY: "openrouter.openrouter-default.api-key.api-key";
} = {
  API_KEY: "openrouter.openrouter-default.api-key.api-key",
};

export const OpenRouterConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

export type OpenRouterConnectionConfig = z.output<typeof OpenRouterConnectionConfigSchema>;

export function resolveOpenRouterCredentialSecretType(input: unknown): "api_key" {
  const parsedConnectionConfig = OpenRouterConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.connection_method === IntegrationConnectionMethodIds.API_KEY) {
    return OpenRouterCredentialSecretTypes.API_KEY;
  }

  throw new Error(
    `Unsupported OpenRouter connection method '${parsedConnectionConfig.connection_method}'.`,
  );
}
