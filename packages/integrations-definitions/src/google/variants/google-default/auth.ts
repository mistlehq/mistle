import { createOAuth2AuthorizationCodeCredentialSlotKeys } from "@mistle/integrations-core";
import { z } from "zod";

export const GoogleFamilyId = "google";
export const GoogleDefaultVariantId = "google-default";

export const GoogleConnectionMethodIds: {
  OAUTH2_AUTHORIZATION_CODE: "oauth2-authorization-code";
  SERVICE_ACCOUNT: "google-service-account";
  SERVICE_ACCOUNT_DOMAIN_WIDE_DELEGATION: "google-service-account-domain-wide-delegation";
} = {
  OAUTH2_AUTHORIZATION_CODE: "oauth2-authorization-code",
  SERVICE_ACCOUNT: "google-service-account",
  SERVICE_ACCOUNT_DOMAIN_WIDE_DELEGATION: "google-service-account-domain-wide-delegation",
};

export const GoogleCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
  SERVICE_ACCOUNT_KEY_JSON: "google_service_account_key_json";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
  SERVICE_ACCOUNT_KEY_JSON: "google_service_account_key_json",
};

export const GoogleOAuthCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: GoogleFamilyId,
  variantId: GoogleDefaultVariantId,
});

export const GoogleServiceAccountCredentialSlotKeys: {
  SERVICE_ACCOUNT_KEY_JSON: "google.google-default.service-account-key-json";
} = {
  SERVICE_ACCOUNT_KEY_JSON: "google.google-default.service-account-key-json",
};

export const GoogleOAuthScopeSchema = z.string().trim().min(1);

export const GoogleConnectionStartConfigSchema = z
  .object({
    client_id: z.string().trim().min(1),
    client_secret: z.string().trim().min(1),
    scopes: z.array(GoogleOAuthScopeSchema).min(1),
  })
  .strict();

export const GoogleOAuthConnectionConfigSchema = z
  .object({
    connection_method: z.literal(GoogleConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().trim().min(1),
    scopes: z.array(GoogleOAuthScopeSchema).min(1),
  })
  .strict();

export const GoogleServiceAccountConnectionConfigSchema = z
  .object({
    connection_method: z.literal(GoogleConnectionMethodIds.SERVICE_ACCOUNT),
  })
  .strict();

export const GoogleServiceAccountDomainWideDelegationConnectionConfigSchema = z
  .object({
    connection_method: z.literal(GoogleConnectionMethodIds.SERVICE_ACCOUNT_DOMAIN_WIDE_DELEGATION),
  })
  .strict();

export const GoogleConnectionConfigSchema = z.union([
  GoogleOAuthConnectionConfigSchema,
  GoogleServiceAccountConnectionConfigSchema,
  GoogleServiceAccountDomainWideDelegationConnectionConfigSchema,
]);

export type GoogleConnectionStartConfig = z.output<typeof GoogleConnectionStartConfigSchema>;
export type GoogleConnectionConfig = z.output<typeof GoogleConnectionConfigSchema>;
