import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const LinearCredentialSecretTypes: {
  API_KEY: "api_key";
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
} = {
  API_KEY: "api_key",
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
};

export const LinearFamilyId = "linear";
export const LinearDefaultVariantId = "linear-default";

export const LinearApiKeyCredentialSlotKeys: {
  API_KEY: "linear.linear-default.api-key.api-key";
} = {
  API_KEY: "linear.linear-default.api-key.api-key",
};

export const LinearOAuth2CredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: LinearFamilyId,
  variantId: LinearDefaultVariantId,
});

export const LinearCredentialSlotKeys = {
  ...LinearApiKeyCredentialSlotKeys,
  OAUTH2_ACCESS_TOKEN: LinearOAuth2CredentialSlotKeys.accessToken,
} as const;

export const LinearOAuthScopes: ReadonlyArray<string> = ["read", "write"];

export const LinearApiKeyConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .loose();

export const LinearOAuth2ConnectionStartConfigSchema = z
  .object({
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
  })
  .strict();

export const LinearOAuth2ConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export const LinearConnectionConfigSchema = z.union([
  LinearApiKeyConnectionConfigSchema,
  LinearOAuth2ConnectionConfigSchema,
]);

export type LinearOAuth2ConnectionStartConfig = z.output<
  typeof LinearOAuth2ConnectionStartConfigSchema
>;
export type LinearConnectionConfig = z.output<typeof LinearConnectionConfigSchema>;

export function resolveLinearCredential(input: unknown): {
  secretType: "api_key" | "oauth2_access_token";
  slotKey: string;
  authInjectionType: "header" | "bearer";
} {
  const parsedConnectionConfig = LinearConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.connection_method === IntegrationConnectionMethodIds.API_KEY) {
    return {
      authInjectionType: "header",
      secretType: LinearCredentialSecretTypes.API_KEY,
      slotKey: LinearCredentialSlotKeys.API_KEY,
    };
  }

  if (
    parsedConnectionConfig.connection_method ===
    IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE
  ) {
    return {
      authInjectionType: "bearer",
      secretType: LinearCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
      slotKey: LinearCredentialSlotKeys.OAUTH2_ACCESS_TOKEN,
    };
  }

  throw new Error(
    `Unsupported Linear connection method '${parsedConnectionConfig.connection_method}'.`,
  );
}

export function resolveLinearCredentialSecretType(
  input: unknown,
): "api_key" | "oauth2_access_token" {
  return resolveLinearCredential(input).secretType;
}
