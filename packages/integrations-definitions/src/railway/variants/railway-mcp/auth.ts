import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const RailwayFamilyId = "railway";
export const RailwayMcpVariantId = "railway-mcp";
export const RailwayOAuthIssuerUrl = "https://backboard.railway.com";
export const RailwayMcpUrl = "https://mcp.railway.com";

export const RailwayCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
};

export const RailwayCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: RailwayFamilyId,
  variantId: RailwayMcpVariantId,
});

export const RailwayMcpOAuthScopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "workspace:member",
];

export const RailwayConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export type RailwayConnectionConfig = z.output<typeof RailwayConnectionConfigSchema>;
