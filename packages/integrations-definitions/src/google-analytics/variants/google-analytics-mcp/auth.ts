import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const GoogleAnalyticsFamilyId = "google-analytics";
export const GoogleAnalyticsMcpVariantId = "google-analytics-mcp";

export const GoogleAnalyticsCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
};

export const GoogleAnalyticsCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: GoogleAnalyticsFamilyId,
  variantId: GoogleAnalyticsMcpVariantId,
});

export const GoogleAnalyticsOAuthScopes: ReadonlyArray<string> = [
  "https://www.googleapis.com/auth/analytics.readonly",
];

export const GoogleAnalyticsConnectionStartConfigSchema = z
  .object({
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
  })
  .strict();

export const GoogleAnalyticsConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export type GoogleAnalyticsConnectionStartConfig = z.output<
  typeof GoogleAnalyticsConnectionStartConfigSchema
>;
export type GoogleAnalyticsConnectionConfig = z.output<
  typeof GoogleAnalyticsConnectionConfigSchema
>;
