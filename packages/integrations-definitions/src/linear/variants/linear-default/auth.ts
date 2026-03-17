import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const LinearCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const LinearConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .loose();

export type LinearConnectionConfig = z.output<typeof LinearConnectionConfigSchema>;

export function resolveLinearCredentialSecretType(input: unknown): "api_key" {
  const parsedConnectionConfig = LinearConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.connection_method === IntegrationConnectionMethodIds.API_KEY) {
    return LinearCredentialSecretTypes.API_KEY;
  }

  throw new Error(
    `Unsupported Linear connection method '${parsedConnectionConfig.connection_method}'.`,
  );
}
