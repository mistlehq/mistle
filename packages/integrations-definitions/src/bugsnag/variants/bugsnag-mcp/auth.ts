import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const BugSnagFamilyId = "bugsnag";
export const BugSnagMcpVariantId = "bugsnag-mcp";
export const BugSnagOAuthIssuerUrl = "https://oauth.bugsnag.com";
export const BugSnagMcpUrl = "https://bugsnag.mcp.smartbear.com/mcp";

export const BugSnagCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
};

export const BugSnagCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: BugSnagFamilyId,
  variantId: BugSnagMcpVariantId,
});

export const BugSnagMcpOAuthScopes = ["api", "openid", "profile"];

export const BugSnagConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export type BugSnagConnectionConfig = z.output<typeof BugSnagConnectionConfigSchema>;
