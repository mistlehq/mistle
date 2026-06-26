import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const XeroFamilyId = "xero";
export const XeroMcpVariantId = "xero-mcp";

export const XeroConnectionMethodIds = {
  OAUTH2_AUTHORIZATION_CODE: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
} as const;

export const XeroCredentialSecretTypes = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
} as const;

export const XeroCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: XeroFamilyId,
  variantId: XeroMcpVariantId,
});

export const XeroOAuthScopes: ReadonlyArray<string> = ["offline_access"];

export const XeroConnectionStartConfigSchema = z
  .object({
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
    scopes: z.array(z.string().trim().min(1)).default([...XeroOAuthScopes]),
  })
  .strict();

export const XeroConnectionConfigSchema = z
  .object({
    connection_method: z.literal(XeroConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
    scopes: z.array(z.string().trim().min(1)),
  })
  .strict();

export type XeroConnectionStartConfig = z.output<typeof XeroConnectionStartConfigSchema>;
export type XeroConnectionConfig = z.output<typeof XeroConnectionConfigSchema>;
