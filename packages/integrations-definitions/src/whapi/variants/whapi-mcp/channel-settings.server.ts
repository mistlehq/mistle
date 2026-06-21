import { IntegrationWebhookTriggerCapabilitiesProviderMetadataKey } from "@mistle/integrations-core";
import { z } from "zod";

const WhapiSettingsResponseErrorSchema = z.looseObject({
  error: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
});

export const WhapiWebhookSettingsSchema = z.looseObject({
  events: z.array(
    z.looseObject({
      method: z.string().min(1),
      type: z.string().min(1),
    }),
  ),
  mode: z.string().min(1),
  url: z.string().min(1),
});

export const WhapiChannelSettingsSchema = z.looseObject({
  webhooks: z.array(WhapiWebhookSettingsSchema),
});

export type WhapiWebhookSettings = z.output<typeof WhapiWebhookSettingsSchema>;

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

export function buildWhapiRequestHeaders(apiToken: string): Record<string, string> {
  return {
    accept: "application/json",
    authorization: `Bearer ${apiToken}`,
  };
}

export function parseWhapiJsonResponse(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

export function ensureWhapiResponseOk(input: {
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

export function resolveVerifiedWhapiWebhookProviderEventTypes(input: {
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

  return configuredWebhook.events.map(
    (eventSetting) => `${eventSetting.type}.${eventSetting.method}`,
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
