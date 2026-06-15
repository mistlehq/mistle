import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const ExpoFamilyId = "expo";
export const ExpoMcpVariantId = "expo-mcp";
export const ExpoMcpIssuerUrl = "https://mcp.expo.dev";
export const ExpoMcpUrl = "https://mcp.expo.dev/mcp";

export const ExpoCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
};

export const ExpoCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: ExpoFamilyId,
  variantId: ExpoMcpVariantId,
});

export const ExpoMcpOAuthScopes = ["mcp:access"];

export const ExpoConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export type ExpoConnectionConfig = z.output<typeof ExpoConnectionConfigSchema>;
