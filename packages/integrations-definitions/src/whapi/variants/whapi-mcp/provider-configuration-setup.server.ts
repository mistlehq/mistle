import {
  IntegrationConnectionMethodIds,
  type IntegrationProviderConfigurationSetupCapability,
} from "@mistle/integrations-core";
import { z } from "zod";

import type { WhapiConnectionConfig } from "./auth.js";
import { WhapiSupportedWebhookEvents } from "./supported-webhook-events.js";
import { WhapiApiBaseUrl, type WhapiTargetConfig } from "./target-config-schema.js";

const WhapiSettingsResponseErrorSchema = z
  .object({
    error: z.string().min(1).optional(),
    message: z.string().min(1).optional(),
  })
  .passthrough();

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

function buildWhapiSettingsErrorMessage(input: {
  responseJson: unknown;
  status: number;
  statusText: string;
}): string {
  const parsedError = WhapiSettingsResponseErrorSchema.safeParse(input.responseJson);
  if (!parsedError.success) {
    return `Whapi channel settings update failed with status ${input.status.toString()} ${input.statusText}.`;
  }

  const detail = parsedError.data.message ?? parsedError.data.error;
  return detail === undefined
    ? `Whapi channel settings update failed with status ${input.status.toString()} ${input.statusText}.`
    : `Whapi channel settings update failed with status ${input.status.toString()} ${input.statusText}: ${detail}`;
}

export function buildWhapiWebhookSettingsRequestBody(input: {
  webhookCallbackUrl: string;
}): Record<string, unknown> {
  return {
    webhooks: [
      {
        events: resolveWhapiWebhookEventSettings().map((eventSetting) => ({
          method: eventSetting.method,
          type: eventSetting.type,
        })),
        mode: "body",
        url: input.webhookCallbackUrl,
      },
    ],
  };
}

export async function configureWhapiChannelWebhook(input: {
  apiBaseUrl: string;
  apiToken: string;
  webhookCallbackUrl: string;
}): Promise<void> {
  const response = await fetch(new URL("/settings", input.apiBaseUrl), {
    method: "PATCH",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.apiToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(
      buildWhapiWebhookSettingsRequestBody({
        webhookCallbackUrl: input.webhookCallbackUrl,
      }),
    ),
  });

  if (response.ok) {
    return;
  }

  let responseJson: unknown;
  try {
    responseJson = await response.json();
  } catch {
    responseJson = null;
  }

  throw new Error(
    buildWhapiSettingsErrorMessage({
      responseJson,
      status: response.status,
      statusText: response.statusText,
    }),
  );
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
