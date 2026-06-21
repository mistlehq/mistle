import {
  IntegrationConnectionMethodIds,
  ProviderConfigurationSetupCompletedConfigKey,
} from "@mistle/integrations-core";
import { z } from "zod";

export const WhapiFamilyId = "whapi";
export const WhapiMcpVariantId = "whapi-mcp";

export const WhapiCredentialSecretTypes = {
  API_TOKEN: "api_key",
};

export const WhapiCredentialSlotKeys = {
  API_TOKEN: "whapi.whapi-mcp.api-key.api-token",
};

export const WhapiConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
    [ProviderConfigurationSetupCompletedConfigKey]: z.string().min(1).optional(),
  })
  .strict();

export type WhapiConnectionConfig = z.output<typeof WhapiConnectionConfigSchema>;
