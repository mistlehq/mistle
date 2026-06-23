import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const GoogleAdsFamilyId = "googleads";
export const GoogleAdsDefaultVariantId = "googleads-default";

export const GoogleAdsCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
  API_KEY: "api_key";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
  API_KEY: "api_key",
};

export const GoogleAdsCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: GoogleAdsFamilyId,
  variantId: GoogleAdsDefaultVariantId,
});
export const GoogleAdsDeveloperTokenCredentialSlotKey =
  "googleads.googleads-default.oauth2-authorization-code.developer-token";

export const GoogleAdsOAuthScopes: ReadonlyArray<string> = [
  "https://www.googleapis.com/auth/adwords",
];

export const GoogleAdsConnectionStartConfigSchema = z
  .object({
    client_id: z.string().trim().min(1),
    client_secret: z.string().trim().min(1),
    developer_token: z.string().trim().min(1),
  })
  .strict();

export const GoogleAdsConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().trim().min(1),
  })
  .strict();

export type GoogleAdsConnectionStartConfig = z.output<typeof GoogleAdsConnectionStartConfigSchema>;
export type GoogleAdsConnectionConfig = z.output<typeof GoogleAdsConnectionConfigSchema>;
