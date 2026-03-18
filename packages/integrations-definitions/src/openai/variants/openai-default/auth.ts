import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const OpenAiApiKeyCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const OpenAiConnectionConfigSchema = z.looseObject({
  connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
});

export type OpenAiConnectionConfig = z.output<typeof OpenAiConnectionConfigSchema>;

export function resolveOpenAiCredentialSecretType(input: unknown): "api_key" {
  const parsedConnectionConfig = OpenAiConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.connection_method === IntegrationConnectionMethodIds.API_KEY) {
    return OpenAiApiKeyCredentialSecretTypes.API_KEY;
  }

  throw new Error(
    `Unsupported OpenAI connection method '${parsedConnectionConfig.connection_method}'.`,
  );
}
