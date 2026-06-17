import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const WhapiFamilyId = "whapi";
export const WhapiMcpVariantId = "whapi-mcp";

export const WhapiCredentialSecretTypes = {
  API_TOKEN: "api_key",
  WEBHOOK_SECRET: "api_key",
};

export const WhapiCredentialSlotKeys = {
  API_TOKEN: "whapi.whapi-mcp.api-key.api-token",
  WEBHOOK_SECRET: "whapi.whapi-mcp.api-key.webhook-secret",
};

export const WhapiConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

export type WhapiConnectionConfig = z.output<typeof WhapiConnectionConfigSchema>;
