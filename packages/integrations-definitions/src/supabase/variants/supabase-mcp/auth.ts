import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const SupabaseFamilyId = "supabase";
export const SupabaseMcpVariantId = "supabase-mcp";
export const SupabaseOAuthIssuerUrl = "https://api.supabase.com";
export const SupabaseMcpUrl = "https://mcp.supabase.com/mcp";

export const SupabaseCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
};

export const SupabaseCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: SupabaseFamilyId,
  variantId: SupabaseMcpVariantId,
});

export const SupabaseConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export type SupabaseConnectionConfig = z.output<typeof SupabaseConnectionConfigSchema>;
