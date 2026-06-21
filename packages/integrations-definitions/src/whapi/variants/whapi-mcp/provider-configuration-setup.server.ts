import {
  IntegrationConnectionMethodIds,
  type IntegrationProviderConfigurationSetupCapability,
} from "@mistle/integrations-core";

import type { WhapiConnectionConfig } from "./auth.js";
import {
  buildWhapiRequestHeaders,
  ensureWhapiResponseOk,
  loadWhapiChannelSettings,
  parseWhapiJsonResponse,
  resolveVerifiedWhapiWebhookProviderEventTypes,
  WhapiChannelSettingsSchema,
  type WhapiWebhookSettings,
} from "./channel-settings.server.js";
import { WhapiSupportedWebhookEvents } from "./supported-webhook-events.js";
import { WhapiApiBaseUrl, type WhapiTargetConfig } from "./target-config-schema.js";

type WhapiWebhookEventSetting = {
  method: string;
  type: string;
};

function resolveWhapiWebhookEventSettings(): readonly WhapiWebhookEventSetting[] {
  return WhapiSupportedWebhookEvents.map((eventDefinition) => {
    const [type, method] = eventDefinition.providerEventType.split(".");
    if (type === undefined || type.length === 0 || method === undefined || method.length === 0) {
      throw new Error(
        `Whapi provider event type '${eventDefinition.providerEventType}' is not supported for settings configuration.`,
      );
    }

    return {
      type,
      method,
    };
  });
}

function resolveWhapiSetupSecret(input: {
  connectionSecrets: Record<string, string>;
  fieldName: string;
  label: string;
}): string {
  const value = input.connectionSecrets[input.fieldName]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`Whapi provider configuration setup requires ${input.label}.`);
  }

  return value;
}

function formatWhapiWebhookEventSetting(input: WhapiWebhookEventSetting): string {
  return `${input.type}.${input.method}`;
}

function assertWhapiChannelWebhookIncludesExpectedEvents(input: {
  settingsJson: unknown;
  webhookCallbackUrl: string;
}): void {
  const configuredEventKeys = new Set(resolveVerifiedWhapiWebhookProviderEventTypes(input));
  const missingExpectedEvents = resolveWhapiWebhookEventSettings().filter(
    (eventSetting) => !configuredEventKeys.has(formatWhapiWebhookEventSetting(eventSetting)),
  );
  if (missingExpectedEvents.length > 0) {
    throw new Error(
      `Whapi channel settings verification failed: webhook URL '${input.webhookCallbackUrl}' is missing expected events: ${missingExpectedEvents.map(formatWhapiWebhookEventSetting).join(", ")}.`,
    );
  }
}

function buildWhapiMistleWebhookSettings(input: {
  webhookCallbackUrl: string;
}): WhapiWebhookSettings {
  return {
    events: resolveWhapiWebhookEventSettings().map((eventSetting) => ({
      method: eventSetting.method,
      type: eventSetting.type,
    })),
    mode: "body",
    url: input.webhookCallbackUrl,
  };
}

export function buildWhapiWebhookSettingsRequestBody(input: {
  currentSettingsJson?: unknown;
  webhookCallbackUrl: string;
}): Record<string, unknown> {
  const existingWebhooks =
    input.currentSettingsJson === undefined
      ? []
      : WhapiChannelSettingsSchema.parse(input.currentSettingsJson).webhooks.filter(
          (webhook) => webhook.url !== input.webhookCallbackUrl,
        );

  return {
    webhooks: [
      ...existingWebhooks,
      buildWhapiMistleWebhookSettings({
        webhookCallbackUrl: input.webhookCallbackUrl,
      }),
    ],
  };
}

export async function configureWhapiChannelWebhook(input: {
  apiBaseUrl: string;
  apiToken: string;
  webhookCallbackUrl: string;
}): Promise<void> {
  const currentSettingsJson = await loadWhapiChannelSettings({
    apiBaseUrl: input.apiBaseUrl,
    apiToken: input.apiToken,
  });
  const updateResponse = await fetch(new URL("/settings", input.apiBaseUrl), {
    method: "PATCH",
    headers: {
      ...buildWhapiRequestHeaders(input.apiToken),
      "content-type": "application/json",
    },
    body: JSON.stringify(
      buildWhapiWebhookSettingsRequestBody({
        currentSettingsJson,
        webhookCallbackUrl: input.webhookCallbackUrl,
      }),
    ),
  });
  ensureWhapiResponseOk({
    operation: "update",
    response: updateResponse,
    responseJson: await parseWhapiJsonResponse(updateResponse),
  });

  assertWhapiChannelWebhookIncludesExpectedEvents({
    settingsJson: await loadWhapiChannelSettings({
      apiBaseUrl: input.apiBaseUrl,
      apiToken: input.apiToken,
    }),
    webhookCallbackUrl: input.webhookCallbackUrl,
  });
}

export const WhapiProviderConfigurationSetupCapability: IntegrationProviderConfigurationSetupCapability<
  WhapiTargetConfig,
  Record<string, string>,
  WhapiConnectionConfig
> = {
  flows: [
    {
      methodId: IntegrationConnectionMethodIds.API_KEY,
      requiresWebhookCallbackUrl: true,
      routeSegment: "provider-configuration",
      async complete(input) {
        if (input.webhookCallbackUrl === undefined) {
          throw new Error(
            `Whapi provider configuration setup for connection '${input.connection.id}' requires a webhook callback URL.`,
          );
        }

        await configureWhapiChannelWebhook({
          apiBaseUrl: WhapiApiBaseUrl,
          apiToken: resolveWhapiSetupSecret({
            connectionSecrets: input.connectionSecrets,
            fieldName: "apiToken",
            label: "an API token",
          }),
          webhookCallbackUrl: input.webhookCallbackUrl,
        });
      },
    },
  ],
};
