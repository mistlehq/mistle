import {
  integrationConnectionCredentials,
  integrationConnectionRedirectSessions,
  integrationConnections,
  integrationCredentials,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { IntegrationCredentialSecretKinds } from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
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
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { resolveConnectionSecretOrThrow } from "../../../identity-linking/services/resolve-connection-secret.js";
import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../../lib/crypto.js";
import type { AppContext } from "../../../types.js";
import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../../constants.js";
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
import {
  ensureImplicitConnectionWebhookSource,
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

  const organizationCredentialKey = await ctx.db.query.organizationCredentialKeys.findFirst({
    where: (table, { eq }) => eq(table.organizationId, redirectSession.organizationId),
    orderBy: (table, { desc }) => [desc(table.version)],
  });

  if (organizationCredentialKey === undefined) {
    throw new Error(
      `Organization credential key is missing for '${redirectSession.organizationId}'.`,
    );
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: ctx.integrationsConfig.masterEncryptionKeys,
  });
  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    return await ctx.db.transaction(async (tx) => {
      const consumedSessionRows = await tx
        .update(integrationConnectionRedirectSessions)
        .set({
          usedAt: sql`now()`,
        })
        .where(
          and(
            eq(integrationConnectionRedirectSessions.id, redirectSession.id),
            isNull(integrationConnectionRedirectSessions.usedAt),
          ),
        )
        .returning({
          id: integrationConnectionRedirectSessions.id,
        });

      if (consumedSessionRows.length !== 1) {
        throw new BadRequestError(
          IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
          "Redirect state has already been used.",
        );
      }

      for (const parsedSecret of parsedSecrets) {
        const encryptedSecret = encryptCredentialUtf8({
          plaintext: parsedSecret.normalizedValue,
          organizationCredentialKey: unwrappedOrganizationCredentialKey,
        });

        const [createdCredential] = await tx
          .insert(integrationCredentials)
          .values({
            organizationId: redirectSession.organizationId,
            secretKind: parsedSecret.persistedSecretRef.secretKind,
            ciphertext: encryptedSecret.ciphertext,
            nonce: encryptedSecret.nonce,
            organizationCredentialKeyVersion: organizationCredentialKey.version,
            intendedFamilyId: connection.target.familyId,
          })
          .returning({
            id: integrationCredentials.id,
          });

        if (createdCredential === undefined) {
          throw new Error("Failed to create Slack bot token credential.");
        }

        await tx
          .insert(integrationConnectionCredentials)
          .values({
            connectionId: connection.id,
            credentialId: createdCredential.id,
            slotKey: parsedSecret.persistedSecretRef.slotKey,
          })
          .onConflictDoUpdate({
            target: [
              integrationConnectionCredentials.connectionId,
              integrationConnectionCredentials.slotKey,
            ],
            set: {
              credentialId: createdCredential.id,
            },
          });
      }

      const [updatedConnection] = await tx
        .update(integrationConnections)
        .set({
          externalSubjectId: slackOAuthAccess.team?.id ?? slackOAuthAccess.app_id ?? null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(integrationConnections.id, connection.id),
            eq(integrationConnections.organizationId, redirectSession.organizationId),
          ),
        )
        .returning();

      if (updatedConnection === undefined) {
        throw new NotFoundError(
          IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
          `Integration connection '${connection.id}' was not found.`,
        );
      }

      await ensureImplicitConnectionWebhookSource({
        db: tx,
        organizationId: redirectSession.organizationId,
        connectionId: updatedConnection.id,
        targetKey: updatedConnection.targetKey,
      });

      return {
        id: updatedConnection.id,
        targetKey: updatedConnection.targetKey,
      };
    });
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}
