import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const PlanetScaleFamilyId = "planetscale";
export const PlanetScaleMcpVariantId = "planetscale-mcp";

export const PlanetScaleCredentialSecretTypes: {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token";
} = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
};

export const PlanetScaleCredentialSlotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
  familyId: PlanetScaleFamilyId,
  variantId: PlanetScaleMcpVariantId,
});

export const PlanetScaleConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
    client_id: z.string().min(1),
  })
  .strict();

export type PlanetScaleConnectionConfig = z.output<typeof PlanetScaleConnectionConfigSchema>;
