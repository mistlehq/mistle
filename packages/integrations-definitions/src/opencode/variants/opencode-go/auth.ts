import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const OpenCodeGoCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const OpenCodeGoCredentialSlotKeys: {
  API_KEY: "opencode.opencode-go.api-key.api-key";
} = {
  API_KEY: "opencode.opencode-go.api-key.api-key",
};

export const OpenCodeGoConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

export type OpenCodeGoConnectionConfig = z.output<typeof OpenCodeGoConnectionConfigSchema>;

export function resolveOpenCodeGoCredentialSecretType(input: unknown): "api_key" {
  const parsedConnectionConfig = OpenCodeGoConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.connection_method === IntegrationConnectionMethodIds.API_KEY) {
    return OpenCodeGoCredentialSecretTypes.API_KEY;
  }

  throw new Error(
    `Unsupported OpenCode Go connection method '${parsedConnectionConfig.connection_method}'.`,
  );
}
