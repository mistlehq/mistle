import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const StripeFamilyId = "stripe";
export const StripeMcpVariantId = "stripe-mcp";
export const StripeMcpIssuerUrl = "https://access.stripe.com/mcp";
export const StripeMcpUrl = "https://mcp.stripe.com";

export const StripeCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
};

export const StripeCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: StripeFamilyId,
  variantId: StripeMcpVariantId,
});

export const StripeConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export type StripeConnectionConfig = z.output<typeof StripeConnectionConfigSchema>;
