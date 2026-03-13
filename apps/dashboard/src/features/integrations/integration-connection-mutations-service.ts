import { requestControlPlane } from "../api/request-control-plane.js";
import {
  type CreatedIntegrationConnection,
  type StartedOAuthConnection,
  IntegrationConnectionSchema,
  StartedOAuthConnectionSchema,
  readJsonWithSchema,
  wrapIntegrationsApiError,
} from "./integrations-service-shared.js";

export async function createApiKeyIntegrationConnection(input: {
  targetKey: string;
  displayName: string;
  apiKey: string;
}): Promise<CreatedIntegrationConnection> {
  try {
    const response = await requestControlPlane({
      operation: "createApiKeyIntegrationConnection",
      method: "POST",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/api-key`,
      body: {
        displayName: input.displayName,
        apiKey: input.apiKey,
      },
      fallbackMessage: "Could not create integration connection.",
    });

    return readJsonWithSchema({
      response,
      schema: IntegrationConnectionSchema,
      operation: "createApiKeyIntegrationConnection",
    });
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "createApiKeyIntegrationConnection",
      error,
      fallbackMessage: "Could not create integration connection.",
    });
  }
}

export async function updateIntegrationConnection(input: {
  connectionId: string;
  displayName: string;
  apiKey?: string;
}): Promise<CreatedIntegrationConnection> {
  try {
    const response = await requestControlPlane({
      operation: "updateIntegrationConnection",
      method: "PUT",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.connectionId)}`,
      body: {
        displayName: input.displayName,
        ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
      },
      fallbackMessage: "Could not update integration connection.",
    });

    return readJsonWithSchema({
      response,
      schema: IntegrationConnectionSchema,
      operation: "updateIntegrationConnection",
    });
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "updateIntegrationConnection",
      error,
      fallbackMessage: "Could not update integration connection.",
    });
  }
}

export async function startOAuthIntegrationConnection(input: {
  targetKey: string;
  displayName?: string;
}): Promise<StartedOAuthConnection> {
  try {
    const response = await requestControlPlane({
      operation: "startOAuthIntegrationConnection",
      method: "POST",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/oauth/start`,
      ...(input.displayName === undefined ? {} : { body: { displayName: input.displayName } }),
      fallbackMessage: "Could not start OAuth connection.",
    });

    return readJsonWithSchema({
      response,
      schema: StartedOAuthConnectionSchema,
      operation: "startOAuthIntegrationConnection",
    });
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "startOAuthIntegrationConnection",
      error,
      fallbackMessage: "Could not start OAuth connection.",
    });
  }
}
