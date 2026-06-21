import {
  IntegrationConnectionMethodIds,
  IntegrationWebhookTriggerCapabilitiesProviderMetadataKey,
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

const WhapiWebhookSettingsSchema = z
  .object({
    events: z.array(
      z
        .object({
          method: z.string().min(1),
          type: z.string().min(1),
        })
        .passthrough(),
    ),
    mode: z.string().min(1),
    url: z.string().min(1),
  })
  .passthrough();

const WhapiChannelSettingsSchema = z
  .object({
    webhooks: z.array(WhapiWebhookSettingsSchema),
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
  operation: "read" | "update";
  responseJson: unknown;
  status: number;
  statusText: string;
}): string {
  const parsedError = WhapiSettingsResponseErrorSchema.safeParse(input.responseJson);
  const operationLabel = input.operation === "read" ? "read" : "update";
  if (!parsedError.success) {
    return `Whapi channel settings ${operationLabel} failed with status ${input.status.toString()} ${input.statusText}.`;
  }

  const detail = parsedError.data.message ?? parsedError.data.error;
  return detail === undefined
    ? `Whapi channel settings ${operationLabel} failed with status ${input.status.toString()} ${input.statusText}.`
    : `Whapi channel settings ${operationLabel} failed with status ${input.status.toString()} ${input.statusText}: ${detail}`;
}

function formatWhapiWebhookEventSetting(input: WhapiWebhookEventSetting): string {
  return `${input.type}.${input.method}`;
}

function buildWhapiRequestHeaders(apiToken: string): Record<string, string> {
  return {
    accept: "application/json",
    authorization: `Bearer ${apiToken}`,
  };
}

function parseWhapiJsonResponse(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function ensureWhapiResponseOk(input: {
  operation: "read" | "update";
  response: Response;
  responseJson: unknown;
}): void {
  if (input.response.ok) {
    return;
  }

  throw new Error(
    buildWhapiSettingsErrorMessage({
      operation: input.operation,
      responseJson: input.responseJson,
      status: input.response.status,
      statusText: input.response.statusText,
    }),
  );
}

function resolveVerifiedWhapiWebhookProviderEventTypes(input: {
  settingsJson: unknown;
  webhookCallbackUrl: string;
}): readonly string[] {
  const parsedSettings = WhapiChannelSettingsSchema.safeParse(input.settingsJson);
  if (!parsedSettings.success) {
    throw new Error("Whapi channel settings verification failed: response is missing webhooks.");
  }

  const configuredWebhook = parsedSettings.data.webhooks.find(
    (webhook) => webhook.url === input.webhookCallbackUrl,
  );
  if (configuredWebhook === undefined) {
    throw new Error(
      `Whapi channel settings verification failed: webhook URL '${input.webhookCallbackUrl}' is not configured.`,
    );
  }
  if (configuredWebhook.mode !== "body") {
    throw new Error(
      `Whapi channel settings verification failed: webhook URL '${input.webhookCallbackUrl}' is configured with mode '${configuredWebhook.mode}' instead of 'body'.`,
    );
  }

  return configuredWebhook.events.map((eventSetting) =>
    formatWhapiWebhookEventSetting(eventSetting),
  );
}

export function buildWhapiWebhookTriggerCapabilitiesProviderMetadata(input: {
  settingsJson: unknown;
  webhookCallbackUrl: string;
}): Record<string, unknown> {
  return {
    [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
      events: resolveVerifiedWhapiWebhookProviderEventTypes(input),
    },
  };
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

export async function loadWhapiChannelSettings(input: {
  apiBaseUrl: string;
  apiToken: string;
}): Promise<unknown> {
  const response = await fetch(new URL("/settings", input.apiBaseUrl), {
    method: "GET",
    headers: buildWhapiRequestHeaders(input.apiToken),
  });
  const responseJson = await parseWhapiJsonResponse(response);
  ensureWhapiResponseOk({
    operation: "read",
    response,
    responseJson,
  });
  return responseJson;
}

export async function configureWhapiChannelWebhook(input: {
  apiBaseUrl: string;
  apiToken: string;
  webhookCallbackUrl: string;
}): Promise<void> {
  const updateResponse = await fetch(new URL("/settings", input.apiBaseUrl), {
    method: "PATCH",
    headers: {
      ...buildWhapiRequestHeaders(input.apiToken),
      "content-type": "application/json",
    },
    body: JSON.stringify(
      buildWhapiWebhookSettingsRequestBody({
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
