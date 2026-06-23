import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const MetaAdsFamilyId = "metaads";
export const MetaAdsDefaultVariantId = "metaads-default";

export const MetaAdsCredentialSecretTypes = {
  API_KEY: "api_key",
} as const;

export const MetaAdsCredentialSlotKeys = {
  ACCESS_TOKEN: "metaads.metaads-default.api-key.access-token",
} as const;

export const MetaAdsConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

export type MetaAdsConnectionConfig = z.output<typeof MetaAdsConnectionConfigSchema>;
