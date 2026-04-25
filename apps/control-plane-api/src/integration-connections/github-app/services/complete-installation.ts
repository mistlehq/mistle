import {
  integrationConnectionRedirectSessions,
  integrationConnections,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import {
  IntegrationWebhookSourceLifecycles,
  type IntegrationRegistry,
} from "@mistle/integrations-core";
import { and, eq, isNull, sql } from "drizzle-orm";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../../constants.js";
import {
  createRedirectQueryParams,
  resolveGitHubAppInstallationConnectionId,
} from "../../services/redirect-flow.js";
import {
  ensureImplicitConnectionWebhookSource,
  resolveConnectionWithTargetOrThrow,
} from "../../services/webhook-sources.js";
import { parseGitHubAppInstallationConnectionConfigOrThrow } from "./installation-config.js";

type CompleteGitHubAppInstallationConnectionInput = {
  query: Record<string, string>;
};

type CompletedConnection = {
  id: string;
  targetKey: string;
};

function resolveRedirectStateOrThrow(params: URLSearchParams): string {
  const state = params.get("state");
  if (state === null || state.length === 0) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_COMPLETE_INPUT,
      "GitHub App installation callback query must include `state`.",
    );
  }

  return state;
}

function resolveInstallationIdOrThrow(params: URLSearchParams): string {
  const installationId = params.get("installation_id");
  if (installationId === null || installationId.length === 0) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_COMPLETE_INPUT,
      "GitHub App installation callback query must include `installation_id`.",
    );
  }

  return installationId;
}

function resolveGitHubAppInstallationConnectionIdOrThrow(state: string): string {
  try {
    return resolveGitHubAppInstallationConnectionId(state);
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
  },
  input: CompleteGitHubAppInstallationConnectionInput,
): Promise<CompletedConnection> {
  const { db, integrationRegistry } = ctx;

  const queryParams = createRedirectQueryParams(input.query);
  const state = resolveRedirectStateOrThrow(queryParams);

  const redirectSession = await db.query.integrationConnectionRedirectSessions.findFirst({
    where: (table, { eq }) => eq(table.state, state),
  });

  if (redirectSession === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
      "Redirect state is invalid.",
    );
  }

  if (redirectSession.usedAt !== null) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
      "Redirect state has already been used.",
    );
  }

  const now = Date.now();
  const expiresAt = Date.parse(redirectSession.expiresAt);
  if (Number.isNaN(expiresAt)) {
    throw new Error(`Redirect session '${redirectSession.id}' has an invalid expiry timestamp.`);
  }

  if (expiresAt <= now) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_EXPIRED,
      "Redirect state has expired.",
    );
  }

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

  return db.transaction(async (tx) => {
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

    const nextConfig = {
      ...parsedConnectionConfig,
      installation_id: installationId,
      ...(setupAction === null ? {} : { setup_action: setupAction }),
    };

    const [updatedConnection] = await tx
      .update(integrationConnections)
      .set({
        externalSubjectId: installationId,
        config: nextConfig,
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

    const webhookSourceCapability = definition.webhookSource;
    if (
      webhookSourceCapability !== undefined &&
      webhookSourceCapability.lifecycle === IntegrationWebhookSourceLifecycles.IMPLICIT &&
      ((await webhookSourceCapability.supportsConnection?.({
        connection: {
          id: updatedConnection.id,
          status: updatedConnection.status,
          config: updatedConnection.config ?? {},
        },
      })) ??
        true)
    ) {
      await ensureImplicitConnectionWebhookSource({
        db: tx,
        organizationId: redirectSession.organizationId,
        connectionId: updatedConnection.id,
        targetKey: updatedConnection.targetKey,
      });
    }

    return {
      id: updatedConnection.id,
      targetKey: updatedConnection.targetKey,
    };
  });
}
