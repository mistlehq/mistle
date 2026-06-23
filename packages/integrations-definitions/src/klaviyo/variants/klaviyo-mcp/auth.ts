import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const KlaviyoFamilyId = "klaviyo";
export const KlaviyoMcpVariantId = "klaviyo-mcp";
export const KlaviyoMcpIssuerUrl = "https://mcp.klaviyo.com";
export const KlaviyoMcpResource = "https://mcp.klaviyo.com";
export const KlaviyoMcpUrl = "https://mcp.klaviyo.com/mcp";

export const KlaviyoCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
};

export const KlaviyoCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: KlaviyoFamilyId,
  variantId: KlaviyoMcpVariantId,
});

export const KlaviyoConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export type KlaviyoConnectionConfig = z.output<typeof KlaviyoConnectionConfigSchema>;
