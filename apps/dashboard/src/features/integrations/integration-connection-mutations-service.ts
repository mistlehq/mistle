import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";

import { requestControlPlane } from "../api/request-control-plane.js";
import {
  type DeviceAuthorizationAttemptResponse,
  type CreatedFormIntegrationConnection,
  type CreatedIntegrationConnection,
  type DeletedIntegrationConnection,
  type IntegrationConnectionMethod,
  type StartedProviderAppSetup,
  type StartedRedirectConnection,
  type StartedDeviceAuthorizationConnection,
  DeviceAuthorizationAttemptResponseSchema,
  CreatedFormIntegrationConnectionSchema,
  DeletedIntegrationConnectionSchema,
  IntegrationConnectionSchema,
  StartedProviderAppSetupSchema,
  StartedDeviceAuthorizationConnectionSchema,
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
}): Promise<CreatedFormIntegrationConnection> {
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
      schema: CreatedFormIntegrationConnectionSchema,
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

export async function createDraftFormIntegrationConnection(input: {
  targetKey: string;
  methodId: IntegrationConnectionMethod["id"];
  displayName: string;
}): Promise<CreatedIntegrationConnection> {
  try {
    const response = await requestControlPlane({
      operation: "createDraftFormIntegrationConnection",
      method: "POST",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/${encodeURIComponent(input.methodId)}/draft`,
      body: {
        displayName: input.displayName,
      },
      fallbackMessage: "Could not create integration connection.",
    });

    return readJsonWithSchema({
      response,
      schema: IntegrationConnectionSchema,
      operation: "createDraftFormIntegrationConnection",
    });
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "createDraftFormIntegrationConnection",
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
  config?: Record<string, unknown>;
}): Promise<CreatedIntegrationConnection> {
  try {
    const response = await requestControlPlane({
      operation: "updateIntegrationConnection",
      method: "PUT",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.connectionId)}`,
      body: {
        displayName: input.displayName,
        ...(input.config === undefined ? {} : { config: input.config }),
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
  displayName?: string;
  config?: Record<string, unknown>;
}): Promise<StartedRedirectConnection> {
  try {
    const response = await requestControlPlane({
      operation: "startRedirectIntegrationConnection",
      method: "POST",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/oauth2-authorization-code/start`,
      ...(input.displayName === undefined && input.config === undefined
        ? {}
        : {
            body: {
              ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
              ...(input.config === undefined ? {} : { config: input.config }),
            },
          }),
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

export async function startDeviceAuthorizationIntegrationConnection(input: {
  targetKey: string;
  methodId: IntegrationConnectionMethod["id"];
  displayName?: string;
}): Promise<StartedDeviceAuthorizationConnection> {
  try {
    const response = await requestControlPlane({
      operation: "startDeviceAuthorizationIntegrationConnection",
      method: "POST",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/device-authorization/attempts`,
      body: {
        methodId: input.methodId,
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      },
      fallbackMessage: "Could not start integration connection.",
    });

    return readJsonWithSchema({
      response,
      schema: StartedDeviceAuthorizationConnectionSchema,
      operation: "startDeviceAuthorizationIntegrationConnection",
    });
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "startDeviceAuthorizationIntegrationConnection",
      error,
      fallbackMessage: "Could not start integration connection.",
    });
  }
}

export async function getDeviceAuthorizationAttempt(input: {
  targetKey: string;
  attemptId: string;
}): Promise<DeviceAuthorizationAttemptResponse> {
  try {
    const response = await requestControlPlane({
      operation: "getDeviceAuthorizationAttempt",
      method: "GET",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/device-authorization/attempts/${encodeURIComponent(input.attemptId)}`,
      fallbackMessage: "Could not read integration connection status.",
    });

    return readJsonWithSchema({
      response,
      schema: DeviceAuthorizationAttemptResponseSchema,
      operation: "getDeviceAuthorizationAttempt",
    });
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "getDeviceAuthorizationAttempt",
      error,
      fallbackMessage: "Could not read integration connection status.",
    });
  }
}

export async function cancelDeviceAuthorizationAttempt(input: {
  targetKey: string;
  attemptId: string;
}): Promise<DeviceAuthorizationAttemptResponse> {
  try {
    const response = await requestControlPlane({
      operation: "cancelDeviceAuthorizationAttempt",
      method: "DELETE",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/device-authorization/attempts/${encodeURIComponent(input.attemptId)}`,
      fallbackMessage: "Could not cancel integration connection.",
    });

    return readJsonWithSchema({
      response,
      schema: DeviceAuthorizationAttemptResponseSchema,
      operation: "cancelDeviceAuthorizationAttempt",
    });
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "cancelDeviceAuthorizationAttempt",
      error,
      fallbackMessage: "Could not cancel integration connection.",
    });
  }
}

export async function startProviderAppSetupInstallation(input: {
  connectionId: string;
}): Promise<StartedRedirectConnection> {
  const startedSetup = await startProviderAppSetup({
    connectionId: input.connectionId,
    routeSegment: "github-app-installation",
    body: {},
    fallbackMessage: "Could not start GitHub App installation.",
  });
  if (startedSetup.kind !== "redirect") {
    throw new Error("GitHub App installation setup did not return a redirect URL.");
  }

  return {
    authorizationUrl: startedSetup.authorizationUrl,
  };
}

export async function startProviderAppSetup(input: {
  connectionId: string;
  routeSegment: string;
  body: Record<string, unknown>;
  fallbackMessage: string;
}): Promise<StartedProviderAppSetup> {
  try {
    const response = await requestControlPlane({
      operation: "startProviderAppSetup",
      method: "POST",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.connectionId)}/setup/${encodeURIComponent(input.routeSegment)}/start`,
      body: input.body,
      fallbackMessage: input.fallbackMessage,
    });

    return readJsonWithSchema({
      response,
      schema: StartedProviderAppSetupSchema,
      operation: "startProviderAppSetup",
    });
  } catch (error) {
    throw wrapIntegrationsApiError({
      operation: "startProviderAppSetup",
      error,
      fallbackMessage: input.fallbackMessage,
    });
  }
}
