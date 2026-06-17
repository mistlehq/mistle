import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const WasenderApiFamilyId = "wasenderapi";
export const WasenderApiMcpVariantId = "wasenderapi-mcp";

export const WasenderApiCredentialSecretTypes = {
  PERSONAL_ACCESS_TOKEN: "api_key",
  WEBHOOK_SECRET: "api_key",
} as const;

export const WasenderApiCredentialSlotKeys = {
  PERSONAL_ACCESS_TOKEN: "wasenderapi.wasenderapi-mcp.api-key.personal-access-token",
  WEBHOOK_SECRET: "wasenderapi.wasenderapi-mcp.api-key.webhook-secret",
} as const;

export const WasenderApiConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

export type WasenderApiConnectionConfig = z.output<typeof WasenderApiConnectionConfigSchema>;
