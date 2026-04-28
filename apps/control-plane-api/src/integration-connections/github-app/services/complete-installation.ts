import { type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import { type IntegrationRegistry } from "@mistle/integrations-core";

import type { AppContext } from "../../../types.js";
import { IntegrationConnectionsBadRequestCodes } from "../../constants.js";
import {
  createRedirectQueryParams,
  resolveActiveRedirectSessionOrThrow,
  resolveConnectionRedirectStateConnectionId,
  resolveRequiredRedirectQueryParamOrThrow,
} from "../../services/redirect-flow.js";
import { persistExternalAppSetupResult } from "../../services/setup-result-persistence.js";
import { resolveConnectionWithTargetOrThrow } from "../../services/webhook-sources.js";
import { parseGitHubAppInstallationConnectionConfigOrThrow } from "./installation-config.js";

type CompleteGitHubAppInstallationConnectionInput = {
  query: Record<string, string>;
};

type CompletedConnection = {
  id: string;
  targetKey: string;
};

function resolveRedirectStateOrThrow(params: URLSearchParams): string {
  return resolveRequiredRedirectQueryParamOrThrow({
    params,
    name: "state",
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_COMPLETE_INPUT,
    missingMessage: "GitHub App installation callback query must include `state`.",
  });
}

function resolveInstallationIdOrThrow(params: URLSearchParams): string {
  return resolveRequiredRedirectQueryParamOrThrow({
    params,
    name: "installation_id",
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_COMPLETE_INPUT,
    missingMessage: "GitHub App installation callback query must include `installation_id`.",
  });
}

function resolveGitHubAppInstallationConnectionIdOrThrow(state: string): string {
  try {
    return resolveConnectionRedirectStateConnectionId(state);
  } catch {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
      "Redirect state is invalid.",
    );
  }
}

export async function completeGitHubAppInstallationConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: AppContext["var"]["config"]["integrations"];
  },
  input: CompleteGitHubAppInstallationConnectionInput,
): Promise<CompletedConnection> {
  const { db, integrationRegistry } = ctx;

  const queryParams = createRedirectQueryParams(input.query);
  const state = resolveRedirectStateOrThrow(queryParams);

  const redirectSession = await resolveActiveRedirectSessionOrThrow({
    db,
    state,
    invalidStateCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
    alreadyUsedCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
    expiredCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_EXPIRED,
  });

  const connectionId = resolveGitHubAppInstallationConnectionIdOrThrow(state);
  const installationId = resolveInstallationIdOrThrow(queryParams);
  const setupAction = queryParams.get("setup_action");

  const connection = await resolveConnectionWithTargetOrThrow({
    db,
    organizationId: redirectSession.organizationId,
    connectionId,
  });

  if (connection.targetKey !== redirectSession.targetKey) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
      "Redirect state does not match the target for this connection.",
    );
  }

  const definition = integrationRegistry.getDefinition({
    familyId: connection.target.familyId,
    variantId: connection.target.variantId,
  });

  if (definition === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_COMPLETE_INPUT,
      `Integration definition '${connection.target.familyId}/${connection.target.variantId}' is not registered.`,
    );
  }

  const parsedConnectionConfig = parseGitHubAppInstallationConnectionConfigOrThrow({
    config: connection.config,
    connectionId: connection.id,
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_COMPLETE_INPUT,
  });

  return persistExternalAppSetupResult({
    db,
    integrationsConfig: ctx.integrationsConfig,
    organizationId: redirectSession.organizationId,
    connection,
    definition,
    parsedSecrets: [],
    connectionUpdate: {
      externalSubjectId: installationId,
      config: {
        ...parsedConnectionConfig,
        installation_id: installationId,
        ...(setupAction === null ? {} : { setup_action: setupAction }),
      },
    },
    redirectSession,
  });
}
