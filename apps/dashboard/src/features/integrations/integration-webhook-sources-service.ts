import { requestControlPlane } from "../api/request-control-plane.js";
import {
  CreatedIntegrationWebhookSourceSchema,
  IntegrationWebhookSourceSchema,
  readJsonWithSchema,
  type CreatedIntegrationWebhookSource,
  type IntegrationWebhookSource,
  wrapIntegrationsApiError,
} from "./integrations-service-shared.js";

export async function listIntegrationWebhookSources(input: {
  connectionId: string;
  signal?: AbortSignal;
}): Promise<readonly IntegrationWebhookSource[]> {
  try {
    const response = await requestControlPlane({
      operation: "listIntegrationWebhookSources",
      method: "GET",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.connectionId)}/webhook-sources`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load integration webhook sources.",
    });

    return await readJsonWithSchema({
      response,
      schema: IntegrationWebhookSourceSchema.array(),
      operation: "listIntegrationWebhookSources",
    });
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "listIntegrationWebhookSources",
      error,
      fallbackMessage: "Could not load integration webhook sources.",
    });
  }
}

export async function createIntegrationWebhookSource(input: {
  connectionId: string;
  displayName?: string;
}): Promise<CreatedIntegrationWebhookSource> {
  try {
    const response = await requestControlPlane({
      operation: "createIntegrationWebhookSource",
      method: "POST",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.connectionId)}/webhook-sources`,
      body: input.displayName === undefined ? {} : { displayName: input.displayName },
      fallbackMessage: "Could not create integration webhook source.",
    });

    return await readJsonWithSchema({
      response,
      schema: CreatedIntegrationWebhookSourceSchema,
      operation: "createIntegrationWebhookSource",
    });
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "createIntegrationWebhookSource",
      error,
      fallbackMessage: "Could not create integration webhook source.",
    });
  }
}

export async function refreshIntegrationWebhookTriggerCapabilities(input: {
  body: Readonly<Record<string, unknown>>;
  connectionId: string;
}): Promise<IntegrationWebhookSource> {
  try {
    const response = await requestControlPlane({
      operation: "refreshIntegrationWebhookTriggerCapabilities",
      method: "POST",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.connectionId)}/webhook-sources/trigger-capabilities/refresh`,
      body: input.body,
      fallbackMessage: "Could not sync webhook events.",
    });

    return await readJsonWithSchema({
      response,
      schema: IntegrationWebhookSourceSchema,
      operation: "refreshIntegrationWebhookTriggerCapabilities",
    });
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "refreshIntegrationWebhookTriggerCapabilities",
      error,
      fallbackMessage: "Could not sync webhook events.",
    });
  }
}

export async function deleteIntegrationWebhookSource(input: {
  connectionId: string;
  webhookSourceId: string;
}): Promise<void> {
  try {
    await requestControlPlane({
      operation: "deleteIntegrationWebhookSource",
      method: "DELETE",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.connectionId)}/webhook-sources/${encodeURIComponent(input.webhookSourceId)}`,
      fallbackMessage: "Could not delete integration webhook source.",
    });
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "deleteIntegrationWebhookSource",
      error,
      fallbackMessage: "Could not delete integration webhook source.",
    });
  }
}
