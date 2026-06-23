import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const GoogleSearchConsoleFamilyId = "google-search-console";
export const GoogleSearchConsoleMcpVariantId = "google-search-console-mcp";

export const GoogleSearchConsoleCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
};

export const GoogleSearchConsoleCredentialSlotKeys =
  createOAuth2AuthorizationCodeCredentialSlotKeys({
    familyId: GoogleSearchConsoleFamilyId,
    variantId: GoogleSearchConsoleMcpVariantId,
  });

export const GoogleSearchConsoleOAuthScopes: ReadonlyArray<string> = [
  "https://www.googleapis.com/auth/webmasters.readonly",
];

export const GoogleSearchConsoleConnectionStartConfigSchema = z
  .object({
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
  })
  .strict();

export const GoogleSearchConsoleConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export type GoogleSearchConsoleConnectionStartConfig = z.output<
  typeof GoogleSearchConsoleConnectionStartConfigSchema
>;
export type GoogleSearchConsoleConnectionConfig = z.output<
  typeof GoogleSearchConsoleConnectionConfigSchema
>;
