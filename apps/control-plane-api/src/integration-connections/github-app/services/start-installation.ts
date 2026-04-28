import { type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { buildGitHubAppInstallationUrl } from "@mistle/integrations-definitions/server";

import {
  InternalIntegrationCredentialsError,
  InternalIntegrationCredentialsErrorCodes,
} from "../../../internal/integration-credentials/services/errors.js";
import type { AppContext } from "../../../types.js";
import { IntegrationConnectionsBadRequestCodes } from "../../constants.js";
import {
  createRedirectSessionExpiryTimestamp,
  createRedirectState,
  encodeConnectionRedirectStateMetadata,
  persistRedirectSessionOrThrow,
} from "../../services/redirect-flow.js";
import {
  resolveConnectionSecretsOrThrow,
  resolveConnectionWithTargetOrThrow,
} from "../../services/webhook-sources.js";
import {
  parseGitHubAppInstallationConnectionConfigOrThrow,
  parseGitHubTargetConfigOrThrow,
} from "./installation-config.js";

type StartGitHubAppInstallationConnectionInput = {
  organizationId: string;
  connectionId: string;
};

type StartedGitHubAppInstallationConnection = {
  authorizationUrl: string;
};

export async function startGitHubAppInstallationConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: AppContext["var"]["config"]["integrations"];
  },
  input: StartGitHubAppInstallationConnectionInput,
): Promise<StartedGitHubAppInstallationConnection> {
  const { db, integrationRegistry, integrationsConfig } = ctx;

  const connection = await resolveConnectionWithTargetOrThrow({
    db,
    organizationId: input.organizationId,
    connectionId: input.connectionId,
  });
  const definition = integrationRegistry.getDefinition({
    familyId: connection.target.familyId,
    variantId: connection.target.variantId,
  });

  if (definition === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_START_INPUT,
      `Integration definition '${connection.target.familyId}/${connection.target.variantId}' is not registered.`,
    );
  }

  const parsedConnectionConfig = parseGitHubAppInstallationConnectionConfigOrThrow({
    config: connection.config,
    connectionId: input.connectionId,
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_START_INPUT,
  });
  try {
    await resolveConnectionSecretsOrThrow({
      db,
      integrationRegistry,
      connection,
      integrationsConfig,
    });
  } catch (error) {
    if (
      error instanceof InternalIntegrationCredentialsError &&
      error.code === InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND
    ) {
      throw new BadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_START_INPUT,
        `Integration connection '${input.connectionId}' is missing required GitHub App credentials.`,
      );
    }

    throw error;
  }
  const parsedTargetConfig = parseGitHubTargetConfigOrThrow({
    config: connection.target.config,
    targetKey: connection.targetKey,
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_START_INPUT,
  });
  const state = encodeConnectionRedirectStateMetadata({
    state: createRedirectState(),
    connectionId: connection.id,
  });

  await persistRedirectSessionOrThrow({
    db,
    organizationId: input.organizationId,
    targetKey: connection.targetKey,
    state,
    expiresAt: createRedirectSessionExpiryTimestamp(),
    failureMessage: "Failed to persist redirect session state.",
  });

  return {
    authorizationUrl: buildGitHubAppInstallationUrl({
      appSlug: parsedConnectionConfig.app_slug,
      state,
      variantId: connection.target.variantId,
      webBaseUrl: parsedTargetConfig.webBaseUrl,
    }),
  };
}
