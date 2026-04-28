import { type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { IntegrationCredentialSecretKinds } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import { type IntegrationRegistry } from "@mistle/integrations-core";
import { SlackConnectionMethodId, SlackCredentialSlotKeys } from "@mistle/integrations-definitions";
import {
  buildSlackAppInstallationCompleteUrl,
  buildSlackOAuthAccessConnectionSecrets,
  buildSlackOAuthAccessUrl,
  parseSlackOAuthAccessErrorResponse,
  parseSlackOAuthAccessSuccessResponse,
  type SlackOAuthAccessSuccessResponse,
} from "@mistle/integrations-definitions/server";
import { z } from "zod";

import { resolveConnectionSecretOrThrow } from "../../../identity-linking/services/resolve-connection-secret.js";
import type { AppContext } from "../../../types.js";
import { IntegrationConnectionsBadRequestCodes } from "../../constants.js";
import {
  parseUpdateFormSecretsOrThrow,
  resolveFormConnectionMethodOrThrow,
} from "../../services/form-connection-methods.js";
import {
  createRedirectQueryParams,
  resolveActiveRedirectSessionOrThrow,
  resolveRequiredRedirectQueryParamOrThrow,
  resolveConnectionRedirectStateConnectionId,
} from "../../services/redirect-flow.js";
import { persistExternalAppSetupResult } from "../../services/setup-result-persistence.js";
import {
  resolveConnectionConfigOrThrow,
  resolveConnectionWithTargetOrThrow,
} from "../../services/webhook-sources.js";
import {
  assertSlackAppConnectionMethodOrThrow,
  parseSlackTargetConfigOrThrow,
} from "./slack-app-config.js";

type CompleteSlackAppInstallationInput = {
  query: Record<string, string>;
  controlPlaneBaseUrl: string;
};

type CompletedSlackAppInstallation = {
  id: string;
  targetKey: string;
};

function resolveRedirectStateOrThrow(params: URLSearchParams): string {
  return resolveRequiredRedirectQueryParamOrThrow({
    params,
    name: "state",
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_INSTALLATION_COMPLETE_INPUT,
    missingMessage: "Slack app installation callback query must include `state`.",
  });
}

function resolveAuthorizationCodeOrThrow(params: URLSearchParams): string {
  return resolveRequiredRedirectQueryParamOrThrow({
    params,
    name: "code",
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_INSTALLATION_COMPLETE_INPUT,
    missingMessage: "Slack app installation callback query must include `code`.",
  });
}

function resolveSlackAppInstallationConnectionIdOrThrow(state: string): string {
  try {
    return resolveConnectionRedirectStateConnectionId(state);
  } catch {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
      "Redirect state is invalid.",
    );
  }
}

async function completeSlackOAuthAccess(input: {
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUrl: string;
}): Promise<SlackOAuthAccessSuccessResponse> {
  const body = new URLSearchParams();
  body.set("client_id", input.clientId);
  body.set("client_secret", input.clientSecret);
  body.set("code", input.code);
  body.set("redirect_uri", input.redirectUrl);

  const response = await fetch(buildSlackOAuthAccessUrl({ apiBaseUrl: input.apiBaseUrl }), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const responseJson: unknown = await response.json();
  if (!response.ok) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_INSTALLATION_COMPLETE_INPUT,
      `Slack OAuth installation failed with status ${response.status.toString()}.`,
    );
  }

  const errorResult = parseSlackOAuthAccessErrorResponse(responseJson);
  if (errorResult !== null) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_INSTALLATION_COMPLETE_INPUT,
      `Slack OAuth installation failed: ${errorResult.error}.`,
    );
  }

  try {
    return parseSlackOAuthAccessSuccessResponse(responseJson);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_INSTALLATION_COMPLETE_INPUT,
        "Slack OAuth installation response is invalid.",
      );
    }

    throw error;
  }
}

export async function completeSlackAppInstallation(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: AppContext["var"]["config"]["integrations"];
  },
  input: CompleteSlackAppInstallationInput,
): Promise<CompletedSlackAppInstallation> {
  const queryParams = createRedirectQueryParams(input.query);
  const state = resolveRedirectStateOrThrow(queryParams);
  const code = resolveAuthorizationCodeOrThrow(queryParams);

  const redirectSession = await resolveActiveRedirectSessionOrThrow({
    db: ctx.db,
    state,
    invalidStateCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
    alreadyUsedCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
    expiredCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_EXPIRED,
  });

  const connectionId = resolveSlackAppInstallationConnectionIdOrThrow(state);
  const connection = await resolveConnectionWithTargetOrThrow({
    db: ctx.db,
    organizationId: redirectSession.organizationId,
    connectionId,
  });

  if (connection.targetKey !== redirectSession.targetKey) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
      "Redirect state does not match the target for this connection.",
    );
  }

  const connectionConfig = resolveConnectionConfigOrThrow({
    connectionId: connection.id,
    config: connection.config,
  });
  assertSlackAppConnectionMethodOrThrow({
    connectionId: connection.id,
    config: connectionConfig,
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_INSTALLATION_COMPLETE_INPUT,
  });
  const clientId = connectionConfig["client_id"];
  if (typeof clientId !== "string" || clientId.trim().length === 0) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_INSTALLATION_COMPLETE_INPUT,
      `Integration connection '${connection.id}' is missing Slack client_id.`,
    );
  }

  const parsedTargetConfig = parseSlackTargetConfigOrThrow({
    config: connection.target.config,
    targetKey: connection.targetKey,
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_INSTALLATION_COMPLETE_INPUT,
  });
  const clientSecret = await resolveConnectionSecretOrThrow({
    db: ctx.db,
    organizationId: redirectSession.organizationId,
    connectionId: connection.id,
    slotKey: SlackCredentialSlotKeys.CLIENT_SECRET,
    secretKind: IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
    integrationsConfig: ctx.integrationsConfig,
  });
  const slackOAuthAccess = await completeSlackOAuthAccess({
    apiBaseUrl: parsedTargetConfig.apiBaseUrl,
    clientId: clientId.trim(),
    clientSecret,
    code,
    redirectUrl: buildSlackAppInstallationCompleteUrl({
      controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    }),
  });

  const definition = ctx.integrationRegistry.getDefinition({
    familyId: connection.target.familyId,
    variantId: connection.target.variantId,
  });
  if (definition === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_INSTALLATION_COMPLETE_INPUT,
      `Integration definition '${connection.target.familyId}/${connection.target.variantId}' is not registered.`,
    );
  }

  const formMethod = resolveFormConnectionMethodOrThrow({
    targetKey: connection.targetKey,
    methodId: SlackConnectionMethodId,
    connectionMethods: definition.connectionMethods,
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_INSTALLATION_COMPLETE_INPUT,
  });
  const parsedSecrets = parseUpdateFormSecretsOrThrow({
    method: formMethod,
    secrets: buildSlackOAuthAccessConnectionSecrets({
      accessToken: slackOAuthAccess.access_token,
    }),
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_INSTALLATION_COMPLETE_INPUT,
  });

  return persistExternalAppSetupResult({
    db: ctx.db,
    integrationsConfig: ctx.integrationsConfig,
    organizationId: redirectSession.organizationId,
    connection,
    definition,
    parsedSecrets,
    connectionUpdate: {
      externalSubjectId: slackOAuthAccess.team?.id ?? slackOAuthAccess.app_id ?? null,
    },
    redirectSession,
  });
}
