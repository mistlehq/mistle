import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const AutumnFamilyId = "autumn";
export const AutumnMcpVariantId = "autumn-mcp";

export const AutumnCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const AutumnCredentialSlotKeys: {
  API_KEY: "autumn.autumn-mcp.api-key.api-key";
} = {
  API_KEY: "autumn.autumn-mcp.api-key.api-key",
};

export const AutumnConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

export type AutumnConnectionConfig = z.output<typeof AutumnConnectionConfigSchema>;
