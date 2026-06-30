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
  OAUTH2_CLIENT_SECRET: "oauth2_client_secret";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
  OAUTH2_CLIENT_SECRET: "oauth2_client_secret",
};

export const SentryCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: SentryFamilyId,
  variantId: SentryMcpVariantId,
});

export const SentryInternalIntegrationCredentialSlotKeys: {
  CLIENT_SECRET: "sentry.sentry-mcp.sentry-internal-integration.client-secret";
} = {
  CLIENT_SECRET: "sentry.sentry-mcp.sentry-internal-integration.client-secret",
};

export const SentryConnectionMethodIds: {
  INTERNAL_INTEGRATION: "sentry-internal-integration";
} = {
  INTERNAL_INTEGRATION: "sentry-internal-integration",
};

export const SentryMcpOAuthScopes = ["org:read", "project:write", "team:write", "event:write"];

export const SentryMcpOAuthConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export const SentryInternalIntegrationConnectionConfigSchema = z
  .object({
    connection_method: z.literal(SentryConnectionMethodIds.INTERNAL_INTEGRATION),
  })
  .strict();

export const SentryConnectionConfigSchema = z.union([
  SentryMcpOAuthConnectionConfigSchema,
  SentryInternalIntegrationConnectionConfigSchema,
]);

export type SentryConnectionConfig = z.output<typeof SentryConnectionConfigSchema>;
