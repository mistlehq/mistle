import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const FireworksCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const FireworksCredentialSlotKeys: {
  API_KEY: "fireworks.fireworks-default.api-key.api-key";
} = {
  API_KEY: "fireworks.fireworks-default.api-key.api-key",
};

export const FireworksConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

export type FireworksConnectionConfig = z.output<typeof FireworksConnectionConfigSchema>;

export function resolveFireworksCredentialSecretType(input: unknown): "api_key" {
  const parsedConnectionConfig = FireworksConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.connection_method === IntegrationConnectionMethodIds.API_KEY) {
    return FireworksCredentialSecretTypes.API_KEY;
  }

  throw new Error(
    `Unsupported Fireworks connection method '${parsedConnectionConfig.connection_method}'.`,
  );
}
