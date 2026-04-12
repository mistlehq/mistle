import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const SignozFamilyId = "signoz";
export const SignozMcpVariantId = "signoz-mcp";

export const SignozCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
};

export const SignozCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: SignozFamilyId,
  variantId: SignozMcpVariantId,
});

export const SignozRegionSchema = z
  .string()
  .trim()
  .min(1, "Region is required.")
  .regex(/^[a-z0-9-]+$/u, "Region must use lowercase letters, numbers, or hyphens.");

export const SignozConnectionStartConfigSchema = z
  .object({
    region: SignozRegionSchema,
  })
  .strict();

export const SignozConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    region: SignozRegionSchema,
    client_id: z.string().min(1),
  })
  .strict();

export type SignozConnectionStartConfig = z.output<typeof SignozConnectionStartConfigSchema>;
export type SignozConnectionConfig = z.output<typeof SignozConnectionConfigSchema>;

export function resolveSignozIssuerUrl(region: string): string {
  return `https://mcp.${region}.signoz.cloud`;
}

export function resolveSignozMcpUrl(region: string): string {
  return `${resolveSignozIssuerUrl(region)}/mcp`;
}
