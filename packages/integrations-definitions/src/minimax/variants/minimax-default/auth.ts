import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const MiniMaxCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const MiniMaxCredentialSlotKeys: {
  API_KEY: "minimax.minimax-default.api-key.api-key";
} = {
  API_KEY: "minimax.minimax-default.api-key.api-key",
};

export const MiniMaxConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

export type MiniMaxConnectionConfig = z.output<typeof MiniMaxConnectionConfigSchema>;

export function resolveMiniMaxCredentialSecretType(input: unknown): "api_key" {
  const parsedConnectionConfig = MiniMaxConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.connection_method === IntegrationConnectionMethodIds.API_KEY) {
    return MiniMaxCredentialSecretTypes.API_KEY;
  }

  throw new Error(
    `Unsupported MiniMax connection method '${parsedConnectionConfig.connection_method}'.`,
  );
}
