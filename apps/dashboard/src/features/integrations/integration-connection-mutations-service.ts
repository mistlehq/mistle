import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";

import { requestControlPlane } from "../api/request-control-plane.js";
import {
  type CreatedIntegrationConnection,
  type DeletedIntegrationConnection,
  type IntegrationConnectionMethod,
  type StartedRedirectConnection,
  DeletedIntegrationConnectionSchema,
  IntegrationConnectionSchema,
  StartedRedirectConnectionSchema,
  readJsonWithSchema,
  wrapIntegrationsApiError,
} from "./integrations-service-shared.js";

export async function createFormIntegrationConnection(input: {
  targetKey: string;
  displayName: string;
  methodId: IntegrationConnectionMethod["id"];
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}): Promise<CreatedIntegrationConnection> {
  try {
    const response = await requestControlPlane({
      operation: "createFormIntegrationConnection",
      method: "POST",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/form`,
      body: {
        displayName: input.displayName,
        methodId: input.methodId,
        config: input.config,
        secrets: input.secrets,
      },
      fallbackMessage: "Could not create integration connection.",
    });

    return readJsonWithSchema({
      response,
      schema: IntegrationConnectionSchema,
      operation: "createFormIntegrationConnection",
    });
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "createFormIntegrationConnection",
      error,
      fallbackMessage: "Could not create integration connection.",
    });
  }
}

export async function createApiKeyIntegrationConnection(input: {
  targetKey: string;
  displayName: string;
  apiKey: string;
}): Promise<CreatedIntegrationConnection> {
  return createFormIntegrationConnection({
    targetKey: input.targetKey,
    displayName: input.displayName,
    methodId: IntegrationConnectionMethodIds.API_KEY,
    config: {
      connection_method: IntegrationConnectionMethodIds.API_KEY,
    },
    secrets: {
      apiKey: input.apiKey,
    },
  });
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

export async function updateFormIntegrationConnection(input: {
  connectionId: string;
  displayName: string;
  config: Record<string, unknown>;
  secrets?: Record<string, string>;
}): Promise<CreatedIntegrationConnection> {
  try {
    const response = await requestControlPlane({
      operation: "updateFormIntegrationConnection",
      method: "PUT",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.connectionId)}/form`,
      body: {
        displayName: input.displayName,
        config: input.config,
        ...(input.secrets === undefined ? {} : { secrets: input.secrets }),
      },
      fallbackMessage: "Could not update integration connection.",
    });

    return readJsonWithSchema({
      response,
      schema: IntegrationConnectionSchema,
      operation: "updateFormIntegrationConnection",
    });
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "updateFormIntegrationConnection",
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
  return updateFormIntegrationConnection({
    connectionId: input.connectionId,
    displayName: input.displayName,
    config: {
      connection_method: IntegrationConnectionMethodIds.API_KEY,
    },
    secrets: {
      apiKey: input.apiKey,
    },
  });
}

export async function deleteIntegrationConnection(input: {
  connectionId: string;
}): Promise<DeletedIntegrationConnection> {
  try {
    const response = await requestControlPlane({
      operation: "deleteIntegrationConnection",
      method: "DELETE",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.connectionId)}`,
      fallbackMessage: "Could not delete integration connection.",
    });

    return readJsonWithSchema({
      response,
      schema: DeletedIntegrationConnectionSchema,
      operation: "deleteIntegrationConnection",
    });
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "deleteIntegrationConnection",
      error,
      fallbackMessage: "Could not delete integration connection.",
    });
  }
}

export async function startRedirectIntegrationConnection(input: {
  targetKey: string;
  methodId: "oauth2-authorization-code";
  displayName?: string;
}): Promise<StartedRedirectConnection> {
  try {
    const response = await requestControlPlane({
      operation: "startRedirectIntegrationConnection",
      method: "POST",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/oauth2-authorization-code/start`,
      ...(input.displayName === undefined ? {} : { body: { displayName: input.displayName } }),
      fallbackMessage: "Could not start integration connection.",
    });

    return readJsonWithSchema({
      response,
      schema: StartedRedirectConnectionSchema,
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

export async function startGitHubAppInstallation(input: {
  connectionId: string;
}): Promise<StartedRedirectConnection> {
  try {
    const response = await requestControlPlane({
      operation: "startGitHubAppInstallation",
      method: "POST",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.connectionId)}/github-app-installation/start`,
      fallbackMessage: "Could not start GitHub App installation.",
    });

    return readJsonWithSchema({
      response,
      schema: StartedRedirectConnectionSchema,
      operation: "startGitHubAppInstallation",
    });
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "startGitHubAppInstallation",
      error,
      fallbackMessage: "Could not start GitHub App installation.",
    });
  }
}
