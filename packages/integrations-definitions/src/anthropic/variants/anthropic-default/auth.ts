import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const AnthropicCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const AnthropicCredentialSlotKeys: {
  API_KEY: "anthropic.anthropic-default.api-key.api-key";
} = {
  API_KEY: "anthropic.anthropic-default.api-key.api-key",
};

export const AnthropicConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

export type AnthropicConnectionConfig = z.output<typeof AnthropicConnectionConfigSchema>;

export function resolveAnthropicCredentialSecretType(input: unknown): "api_key" {
  const parsedConnectionConfig = AnthropicConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.connection_method === IntegrationConnectionMethodIds.API_KEY) {
    return AnthropicCredentialSecretTypes.API_KEY;
  }

  throw new Error(
    `Unsupported Anthropic connection method '${parsedConnectionConfig.connection_method}'.`,
  );
}
