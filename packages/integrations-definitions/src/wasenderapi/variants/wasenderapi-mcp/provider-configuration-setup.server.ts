import {
  IntegrationConnectionMethodIds,
  type IntegrationProviderConfigurationSetupCapability,
} from "@mistle/integrations-core";

import type { WasenderApiConnectionConfig } from "./auth.js";
import type { WasenderApiTargetConfig } from "./target-config-schema.js";

function assertWasenderApiSetupSecretPresent(input: {
  connectionSecrets: Record<string, string>;
  fieldName: string;
  label: string;
}): void {
  const value = input.connectionSecrets[input.fieldName]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`WasenderAPI provider configuration setup requires ${input.label}.`);
  }
}

export const WasenderApiProviderConfigurationSetupCapability: IntegrationProviderConfigurationSetupCapability<
  WasenderApiTargetConfig,
  Record<string, string>,
  WasenderApiConnectionConfig
> = {
  flows: [
    {
      methodId: IntegrationConnectionMethodIds.API_KEY,
      requiresWebhookCallbackUrl: true,
      routeSegment: "provider-configuration",
      complete(input) {
        if (input.webhookCallbackUrl === undefined) {
          throw new Error(
            `WasenderAPI provider configuration setup for connection '${input.connection.id}' requires a webhook callback URL.`,
          );
        }

        assertWasenderApiSetupSecretPresent({
          connectionSecrets: input.connectionSecrets,
          fieldName: "personalAccessToken",
          label: "a personal access token",
        });
        assertWasenderApiSetupSecretPresent({
          connectionSecrets: input.connectionSecrets,
          fieldName: "webhookSecret",
          label: "a webhook secret",
        });
      },
    },
  ],
};
