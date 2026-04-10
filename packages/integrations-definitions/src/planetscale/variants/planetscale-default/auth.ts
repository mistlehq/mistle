import {
  createOAuth2AuthorizationCodeCredentialSlotKeys,
  IntegrationConnectionMethodIds,
} from "@mistle/integrations-core";
import { z } from "zod";

export const PlanetScaleCredentialSecretTypes: {
  ACCESS_TOKEN: "oauth2_access_token";
} = {
  ACCESS_TOKEN: "oauth2_access_token",
};

export const PlanetScaleConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
  })
  .strict();

export type PlanetScaleConnectionConfig = z.output<typeof PlanetScaleConnectionConfigSchema>;

export function resolvePlanetScaleCredentialSecretType(input: unknown): "oauth2_access_token" {
  PlanetScaleConnectionConfigSchema.parse(input);
  return PlanetScaleCredentialSecretTypes.ACCESS_TOKEN;
}

export function resolvePlanetScaleCredentialSlotKeys(input: {
  familyId: string;
  variantId: string;
}): {
  accessToken: string;
  refreshToken: string;
} {
  return createOAuth2AuthorizationCodeCredentialSlotKeys({
    familyId: input.familyId,
    variantId: input.variantId,
  });
}
