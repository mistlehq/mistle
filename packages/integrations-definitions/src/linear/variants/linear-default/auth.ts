import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const LinearCredentialSecretTypes: {
  API_KEY: "api_key";
  OAUTH2_CLIENT_SECRET: "oauth2_client_secret";
} = {
  API_KEY: "api_key",
  OAUTH2_CLIENT_SECRET: "oauth2_client_secret",
};

export const LinearFamilyId = "linear";
export const LinearDefaultVariantId = "linear-default";

export const LinearApiKeyCredentialSlotKeys: {
  API_KEY: "linear.linear-default.api-key.api-key";
  OAUTH_APP_CLIENT_SECRET: "linear.linear-default.linear-oauth-app.client-secret";
} = {
  API_KEY: "linear.linear-default.api-key.api-key",
  OAUTH_APP_CLIENT_SECRET: "linear.linear-default.linear-oauth-app.client-secret",
};

export const LinearCredentialSlotKeys = {
  ...LinearApiKeyCredentialSlotKeys,
} as const;

export const LinearConnectionMethodIds: {
  OAUTH_APP: "linear-oauth-app";
} = {
  OAUTH_APP: "linear-oauth-app",
};

export const LinearApiKeyConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .loose();

export const LinearOAuthAppConnectionConfigSchema = z
  .object({
    connection_method: z.literal(LinearConnectionMethodIds.OAUTH_APP),
    client_id: z.string().min(1),
  })
  .strict();

export const LinearConnectionConfigSchema = z.union([
  LinearApiKeyConnectionConfigSchema,
  LinearOAuthAppConnectionConfigSchema,
]);

export type LinearConnectionConfig = z.output<typeof LinearConnectionConfigSchema>;

export function resolveLinearCredential(input: unknown): {
  secretType: "api_key";
  slotKey: string;
  authInjectionType: "header";
} {
  const parsedConnectionConfig = LinearConnectionConfigSchema.parse(input);

  if (parsedConnectionConfig.connection_method === IntegrationConnectionMethodIds.API_KEY) {
    return {
      authInjectionType: "header",
      secretType: LinearCredentialSecretTypes.API_KEY,
      slotKey: LinearCredentialSlotKeys.API_KEY,
    };
  }

  throw new Error(
    `Unsupported Linear connection method '${parsedConnectionConfig.connection_method}'.`,
  );
}

export function resolveLinearCredentialSecretType(input: unknown): "api_key" {
  return resolveLinearCredential(input).secretType;
}
