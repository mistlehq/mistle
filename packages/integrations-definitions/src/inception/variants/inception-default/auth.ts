import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const InceptionCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const InceptionCredentialSlotKeys: {
  API_KEY: "inception.inception-default.api-key.api-key";
} = {
  API_KEY: "inception.inception-default.api-key.api-key",
};

export const InceptionConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

export type InceptionConnectionConfig = z.output<typeof InceptionConnectionConfigSchema>;

export function resolveInceptionCredentialSecretType(input: unknown): "api_key" {
  const parsedConnectionConfig = InceptionConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.connection_method === IntegrationConnectionMethodIds.API_KEY) {
    return InceptionCredentialSecretTypes.API_KEY;
  }

  throw new Error(
    `Unsupported Inception connection method '${parsedConnectionConfig.connection_method}'.`,
  );
}
