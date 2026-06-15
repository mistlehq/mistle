import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const DeepSeekCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const DeepSeekCredentialSlotKeys: {
  API_KEY: "deepseek.deepseek-default.api-key.api-key";
} = {
  API_KEY: "deepseek.deepseek-default.api-key.api-key",
};

export const DeepSeekConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

export type DeepSeekConnectionConfig = z.output<typeof DeepSeekConnectionConfigSchema>;

export function resolveDeepSeekCredentialSecretType(input: unknown): "api_key" {
  const parsedConnectionConfig = DeepSeekConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.connection_method === IntegrationConnectionMethodIds.API_KEY) {
    return DeepSeekCredentialSecretTypes.API_KEY;
  }

  throw new Error(
    `Unsupported DeepSeek connection method '${parsedConnectionConfig.connection_method}'.`,
  );
}
