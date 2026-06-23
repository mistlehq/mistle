import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
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

export const GoogleAdsCredentialSlotKeys: {
  ACCESS_TOKEN: "googleads.googleads-default.api-key.access-token";
  DEVELOPER_TOKEN: "googleads.googleads-default.api-key.developer-token";
} = {
  ACCESS_TOKEN: "googleads.googleads-default.api-key.access-token",
  DEVELOPER_TOKEN: "googleads.googleads-default.api-key.developer-token",
};

export const GoogleAdsConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
    login_customer_id: z.string().trim().min(1).optional(),
  })
  .strict();

export type GoogleAdsConnectionConfig = z.output<typeof GoogleAdsConnectionConfigSchema>;
