import { type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import {
  IntegrationConnectionMethodIds,
  type IntegrationRegistry,
} from "@mistle/integrations-core";
import {
  buildConvertedGitHubAppConnectionConfig,
  buildConvertedGitHubAppConnectionSecrets as buildConvertedGitHubAppConnectionSecretsFromDefinitions,
  buildGitHubAppManifestConversionUrl,
  GitHubAppManifestConversionMissingClientSecretError,
  parseGitHubAppManifestConversionResponse as parseGitHubAppManifestConversionResponseFromDefinitions,
  type GitHubAppManifestConversion,
} from "@mistle/integrations-definitions/server";
import { z } from "zod";

import type { AppContext } from "../../../types.js";
import { IntegrationConnectionsBadRequestCodes } from "../../constants.js";
import {
  parseUpdateFormSecretsOrThrow,
  resolveFormConnectionMethodOrThrow,
} from "../../services/form-connection-methods.js";
import {
  createRedirectQueryParams,
  resolveActiveRedirectSessionOrThrow,
  resolveConnectionRedirectStateConnectionId,
  resolveRequiredRedirectQueryParamOrThrow,
} from "../../services/redirect-flow.js";
import { persistExternalAppSetupResult } from "../../services/setup-result-persistence.js";
import { resolveConnectionWithTargetOrThrow } from "../../services/webhook-sources.js";
import {
  assertGitHubAppInstallationConnectionMethodOrThrow,
  parseGitHubTargetConfigOrThrow,
} from "./installation-config.js";

type CompleteGitHubAppManifestConnectionInput = {
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
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT,
    missingMessage: "GitHub App manifest callback query must include `state`.",
  });
}

function resolveManifestCodeOrThrow(params: URLSearchParams): string {
  return resolveRequiredRedirectQueryParamOrThrow({
    params,
    name: "code",
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT,
    missingMessage: "GitHub App manifest callback query must include `code`.",
  });
}

function resolveGitHubAppManifestConnectionIdOrThrow(state: string): string {
  try {
    return resolveConnectionRedirectStateConnectionId(state);
  } catch {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
      "Redirect state is invalid.",
    );
  }
}

export function parseGitHubAppManifestConversionResponse(
  value: unknown,
): GitHubAppManifestConversion {
  try {
    return parseGitHubAppManifestConversionResponseFromDefinitions(value);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT,
        "GitHub App manifest conversion response is invalid.",
      );
    }

    throw error;
  }
}

async function convertGitHubAppManifest(input: {
  apiBaseUrl: string;
  code: string;
}): Promise<GitHubAppManifestConversion> {
  const response = await fetch(
    buildGitHubAppManifestConversionUrl({
      apiBaseUrl: input.apiBaseUrl,
      code: input.code,
    }),
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
      },
    },
  );

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT,
      `GitHub App manifest conversion failed with status ${response.status.toString()}.${responseBody.length === 0 ? "" : ` Response body: ${responseBody}`}`,
    );
  }

  const responseJson: unknown = await response.json();
  return parseGitHubAppManifestConversionResponse(responseJson);
}

export function buildConvertedConnectionSecrets(input: {
  conversion: GitHubAppManifestConversion;
  supportsClientSecret: boolean;
}): Record<string, string> {
  try {
    return buildConvertedGitHubAppConnectionSecretsFromDefinitions(input);
  } catch (error) {
    if (error instanceof GitHubAppManifestConversionMissingClientSecretError) {
      throw new BadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT,
        error.message,
      );
    }

    throw error;
  }
}

export async function completeGitHubAppManifestConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: AppContext["var"]["config"]["integrations"];
  },
  input: CompleteGitHubAppManifestConnectionInput,
): Promise<CompletedConnection> {
  const queryParams = createRedirectQueryParams(input.query);
  const state = resolveRedirectStateOrThrow(queryParams);
  const code = resolveManifestCodeOrThrow(queryParams);

  const redirectSession = await resolveActiveRedirectSessionOrThrow({
    db: ctx.db,
    state,
    invalidStateCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
    alreadyUsedCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
    expiredCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_EXPIRED,
  });

  const connectionId = resolveGitHubAppManifestConnectionIdOrThrow(state);
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

  assertGitHubAppInstallationConnectionMethodOrThrow({
    connectionId: connection.id,
    config: connection.config,
  });

  const definition = ctx.integrationRegistry.getDefinition({
    familyId: connection.target.familyId,
    variantId: connection.target.variantId,
  });
  if (definition === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT,
      `Integration definition '${connection.target.familyId}/${connection.target.variantId}' is not registered.`,
    );
  }

  const parsedTargetConfig = parseGitHubTargetConfigOrThrow({
    config: connection.target.config,
    targetKey: connection.targetKey,
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT,
  });

  const formMethod = resolveFormConnectionMethodOrThrow({
    targetKey: connection.targetKey,
    methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    connectionMethods: definition.connectionMethods,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
  });
  const supportsClientSecret = formMethod.secretFields.some(
    (field) => field.name === "clientSecret",
  );
  const conversion = await convertGitHubAppManifest({
    apiBaseUrl: parsedTargetConfig.apiBaseUrl,
    code,
  });
  const parsedSecrets = parseUpdateFormSecretsOrThrow({
    method: formMethod,
    secrets: buildConvertedConnectionSecrets({
      conversion,
      supportsClientSecret,
    }),
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT,
  });

  return persistExternalAppSetupResult({
    db: ctx.db,
    integrationsConfig: ctx.integrationsConfig,
    organizationId: redirectSession.organizationId,
    connection,
    definition,
    parsedSecrets,
    connectionUpdate: {
      config: buildConvertedGitHubAppConnectionConfig({ conversion }),
    },
    redirectSession,
  });
}
