import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const NotionFamilyId = "notion";
export const NotionMcpVariantId = "notion-mcp";
export const NotionMcpIssuerUrl = "https://mcp.notion.com";
export const NotionMcpUrl = "https://mcp.notion.com/mcp";

export const NotionCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
};

export const NotionCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: NotionFamilyId,
  variantId: NotionMcpVariantId,
});

export const NotionConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export type NotionConnectionConfig = z.output<typeof NotionConnectionConfigSchema>;
