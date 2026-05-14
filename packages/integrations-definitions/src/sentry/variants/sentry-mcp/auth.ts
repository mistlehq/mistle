import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const SentryFamilyId = "sentry";
export const SentryMcpVariantId = "sentry-mcp";
export const SentryMcpIssuerUrl = "https://mcp.sentry.dev";
export const SentryMcpUrl = "https://mcp.sentry.dev/mcp";

export const SentryCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
};

export const SentryCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: SentryFamilyId,
  variantId: SentryMcpVariantId,
});

export const SentryMcpOAuthScopes = ["org:read", "project:write", "team:write", "event:write"];

export const SentryConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export type SentryConnectionConfig = z.output<typeof SentryConnectionConfigSchema>;
