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
}): Promise<CreatedIntegrationConnection> {
  try {
    const response = await requestControlPlane({
      operation: "updateIntegrationConnection",
      method: "PUT",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.connectionId)}`,
      body: {
        displayName: input.displayName,
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

export async function updateApiKeyIntegrationConnection(input: {
  connectionId: string;
  displayName: string;
  apiKey: string;
}): Promise<CreatedIntegrationConnection> {
  try {
    const response = await requestControlPlane({
      operation: "updateApiKeyIntegrationConnection",
      method: "PUT",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.connectionId)}/api-key`,
      body: {
        displayName: input.displayName,
        apiKey: input.apiKey,
      },
      fallbackMessage: "Could not update integration connection API key.",
    });

    return readJsonWithSchema({
      response,
      schema: IntegrationConnectionSchema,
      operation: "updateApiKeyIntegrationConnection",
    });
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "updateApiKeyIntegrationConnection",
      error,
      fallbackMessage: "Could not update integration connection API key.",
    });
  }
}

export async function startRedirectIntegrationConnection(input: {
  targetKey: string;
  methodId: "oauth2" | "github-app-installation";
  displayName?: string;
}): Promise<StartedOAuthConnection> {
  const pathname =
    input.methodId === "oauth2"
      ? `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/oauth/start`
      : `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/oauth/start`;

  try {
    const response = await requestControlPlane({
      operation: "startRedirectIntegrationConnection",
      method: "POST",
      pathname,
      ...(input.displayName === undefined ? {} : { body: { displayName: input.displayName } }),
      fallbackMessage: "Could not start integration connection.",
    });

    return readJsonWithSchema({
      response,
      schema: StartedOAuthConnectionSchema,
      operation: "startRedirectIntegrationConnection",
    });
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "startRedirectIntegrationConnection",
      error,
      fallbackMessage: "Could not start integration connection.",
    });
  }
}
