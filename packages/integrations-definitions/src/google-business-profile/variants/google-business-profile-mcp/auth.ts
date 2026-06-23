import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const GoogleBusinessProfileFamilyId = "google-business-profile";
export const GoogleBusinessProfileMcpVariantId = "google-business-profile-mcp";

export const GoogleBusinessProfileCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
};

export const GoogleBusinessProfileCredentialSlotKeys =
  createOAuth2AuthorizationCodeCredentialSlotKeys({
    familyId: GoogleBusinessProfileFamilyId,
    variantId: GoogleBusinessProfileMcpVariantId,
  });

export const GoogleBusinessProfileOAuthScopes: ReadonlyArray<string> = [
  "https://www.googleapis.com/auth/business.manage",
];

export const GoogleBusinessProfileConnectionStartConfigSchema = z
  .object({
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
  })
  .strict();

export const GoogleBusinessProfileConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export type GoogleBusinessProfileConnectionStartConfig = z.output<
  typeof GoogleBusinessProfileConnectionStartConfigSchema
>;
export type GoogleBusinessProfileConnectionConfig = z.output<
  typeof GoogleBusinessProfileConnectionConfigSchema
>;
