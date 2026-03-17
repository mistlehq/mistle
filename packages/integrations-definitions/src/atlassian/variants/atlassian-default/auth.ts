import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const AtlassianCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const AtlassianConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .loose();

export type AtlassianConnectionConfig = z.output<typeof AtlassianConnectionConfigSchema>;

export function resolveAtlassianCredentialSecretType(input: unknown): "api_key" {
  const parsedConnectionConfig = AtlassianConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.connection_method === IntegrationConnectionMethodIds.API_KEY) {
    return AtlassianCredentialSecretTypes.API_KEY;
  }

  throw new Error(
    `Unsupported Atlassian connection method '${parsedConnectionConfig.connection_method}'.`,
  );
}
