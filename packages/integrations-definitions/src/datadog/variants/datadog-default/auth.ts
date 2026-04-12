import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const DatadogFamilyId = "datadog";
export const DatadogDefaultVariantId = "datadog-default";

export const DatadogCredentialSecretTypes = {
  API_KEY: "api_key",
} as const;

export const DatadogCredentialSlotKeys = {
  API_KEY: "datadog.datadog-default.api-key.api-key",
  APPLICATION_KEY: "datadog.datadog-default.api-key.application-key",
} as const;

export const DatadogConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

export type DatadogConnectionConfig = z.output<typeof DatadogConnectionConfigSchema>;
