import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const SentryFamilyId = "sentry";
export const SentryDefaultVariantId = "sentry-default";
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
  variantId: SentryDefaultVariantId,
});

export const SentryWebhookSigningSecretCredentialSlotKeys: {
  CLIENT_SECRET: "sentry.sentry-default.sentry-webhook-signing-secret.client-secret";
} = {
  CLIENT_SECRET: "sentry.sentry-default.sentry-webhook-signing-secret.client-secret",
};

export const SentryConnectionMethodIds: {
  WEBHOOK_SIGNING_SECRET: "sentry-webhook-signing-secret";
} = {
  WEBHOOK_SIGNING_SECRET: "sentry-webhook-signing-secret",
};

export const SentryMcpOAuthScopes = ["org:read", "project:write", "team:write", "event:write"];

export const SentryMcpOAuthConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export const SentryWebhookSigningSecretConnectionConfigSchema = z
  .object({
    connection_method: z.literal(SentryConnectionMethodIds.WEBHOOK_SIGNING_SECRET),
  })
  .strict();

export const SentryConnectionConfigSchema = z.union([
  SentryMcpOAuthConnectionConfigSchema,
  SentryWebhookSigningSecretConnectionConfigSchema,
]);

export type SentryConnectionConfig = z.output<typeof SentryConnectionConfigSchema>;
