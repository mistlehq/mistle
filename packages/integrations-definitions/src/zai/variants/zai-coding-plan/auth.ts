import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const ZaiCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const ZaiCredentialSlotKeys: {
  API_KEY: "zai.zai-coding-plan.api-key.api-key";
} = {
  API_KEY: "zai.zai-coding-plan.api-key.api-key",
};

export const ZaiConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

export type ZaiConnectionConfig = z.output<typeof ZaiConnectionConfigSchema>;

export function resolveZaiCredentialSecretType(input: unknown): "api_key" {
  const parsedConnectionConfig = ZaiConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.connection_method === IntegrationConnectionMethodIds.API_KEY) {
    return ZaiCredentialSecretTypes.API_KEY;
  }

  throw new Error(
    `Unsupported Zai connection method '${parsedConnectionConfig.connection_method}'.`,
  );
}
