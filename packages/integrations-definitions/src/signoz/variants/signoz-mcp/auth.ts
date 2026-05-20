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

export const SignozRegionLabels: Record<SignozRegion, string> = {
  us: "US",
  eu: "EU",
};

export const SignozRegionSchema = z.enum(["us", "eu"], {
  error: "Region must be US or EU.",
});

export type SignozRegion = z.output<typeof SignozRegionSchema>;

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

export function resolveSignozIssuerUrl(input: {
  region: string;
  issuerBaseUrl?: string | undefined;
}): string {
  return input.issuerBaseUrl ?? `https://mcp.${input.region}.signoz.cloud`;
}

export function resolveSignozMcpUrl(input: {
  region: string;
  issuerBaseUrl?: string | undefined;
}): string {
  return `${resolveSignozIssuerUrl(input)}/mcp`;
}
