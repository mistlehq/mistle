import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const KimiCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const KimiCredentialSlotKeys: {
  API_KEY: "kimi.kimi-default.api-key.api-key";
} = {
  API_KEY: "kimi.kimi-default.api-key.api-key",
};

export const KimiConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

export type KimiConnectionConfig = z.output<typeof KimiConnectionConfigSchema>;

export function resolveKimiCredentialSecretType(input: unknown): "api_key" {
  const parsedConnectionConfig = KimiConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.connection_method === IntegrationConnectionMethodIds.API_KEY) {
    return KimiCredentialSecretTypes.API_KEY;
  }

  throw new Error(
    `Unsupported Kimi connection method '${parsedConnectionConfig.connection_method}'.`,
  );
}
