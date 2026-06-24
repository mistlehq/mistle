import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const DataForSeoFamilyId = "dataforseo";
export const DataForSeoMcpVariantId = "dataforseo-mcp";
export const DataForSeoOAuthIssuerUrl = "https://data.dataforseo.com";
export const DataForSeoMcpResource = "https://mcp.dataforseo.com";
export const DataForSeoMcpUrl = "https://mcp.dataforseo.com/mcp";

export const DataForSeoCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
};

export const DataForSeoCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: DataForSeoFamilyId,
  variantId: DataForSeoMcpVariantId,
});

export const DataForSeoMcpOAuthScopes = ["api"];

export const DataForSeoConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export type DataForSeoConnectionConfig = z.output<typeof DataForSeoConnectionConfigSchema>;
