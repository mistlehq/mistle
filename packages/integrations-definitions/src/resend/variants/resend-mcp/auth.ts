import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const ResendFamilyId = "resend";
export const ResendMcpVariantId = "resend-mcp";

export const ResendCredentialSecretTypes = {
  API_KEY: "api_key",
} as const;

export const ResendCredentialSlotKeys = {
  API_KEY: "resend.resend-mcp.api-key.api-key",
} as const;

export const ResendConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

export type ResendConnectionConfig = z.output<typeof ResendConnectionConfigSchema>;
