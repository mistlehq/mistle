import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const CloudflareFamilyId = "cloudflare";
export const CloudflareMcpVariantId = "cloudflare-mcp";

export const CloudflareCredentialSecretTypes: {
  API_KEY: "api_key";
} = {
  API_KEY: "api_key",
};

export const CloudflareCredentialSlotKeys: {
  API_KEY: "cloudflare.cloudflare-mcp.api-key.api-key";
} = {
  API_KEY: "cloudflare.cloudflare-mcp.api-key.api-key",
};

export const CloudflareConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

export type CloudflareConnectionConfig = z.output<typeof CloudflareConnectionConfigSchema>;
