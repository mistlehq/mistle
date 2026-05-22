import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const GcpFamilyId = "gcp";
export const GcpMcpVariantId = "gcp-mcp";

export const GcpCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
};

export const GcpCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: GcpFamilyId,
  variantId: GcpMcpVariantId,
});

export const GcpOAuthScopes: ReadonlyArray<string> = [
  "https://www.googleapis.com/auth/cloud-platform",
];

export const GcpConnectionStartConfigSchema = z
  .object({
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
  })
  .strict();

export const GcpConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export type GcpConnectionStartConfig = z.output<typeof GcpConnectionStartConfigSchema>;
export type GcpConnectionConfig = z.output<typeof GcpConnectionConfigSchema>;
