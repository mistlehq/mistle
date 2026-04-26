import {
  integrationConnections,
  type ControlPlaneDatabase,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import {
  IntegrationWebhookSourceLifecycles,
  type IntegrationRegistry,
} from "@mistle/integrations-core";
import { SlackConnectionMethodId } from "@mistle/integrations-definitions";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../../constants.js";
import { buildIntegrationConnectionResponse } from "../../services/build-integration-connection-response.js";
import { ensureImplicitConnectionWebhookSource } from "../../services/webhook-sources.js";

type CreateSlackAppDraftConnectionInput = {
  organizationId: string;
  targetKey: string;
  displayName: string;
};

export async function createSlackAppDraftConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: CreateSlackAppDraftConnectionInput,
): Promise<ReturnType<typeof buildIntegrationConnectionResponse>> {
  const target = await ctx.db.query.integrationTargets.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.targetKey, input.targetKey), eq(table.enabled, true)),
  });

  if (target === undefined) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND,
      `Integration target '${input.targetKey}' was not found.`,
    );
  }

  const definition = ctx.integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });
  if (definition === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
      `Integration definition '${target.familyId}/${target.variantId}' is not registered.`,
    );
  }

  if (definition.familyId !== "slack") {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.SLACK_APP_MANIFEST_NOT_SUPPORTED,
      `Integration target '${input.targetKey}' does not support Slack app manifest drafts.`,
    );
  }

  const slackAppMethod = definition.connectionMethods.find(
    (method) => method.id === SlackConnectionMethodId,
  );
  if (slackAppMethod === undefined || slackAppMethod.kind !== "form") {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.SLACK_APP_MANIFEST_NOT_SUPPORTED,
      `Integration target '${input.targetKey}' does not support Slack app auth.`,
    );
  }

  return await ctx.db.transaction(async (tx) => {
    const [createdConnection] = await tx
      .insert(integrationConnections)
      .values({
        organizationId: input.organizationId,
        targetKey: input.targetKey,
        displayName: input.displayName,
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: SlackConnectionMethodId,
        },
        targetSnapshotConfig: target.config,
      })
      .returning();

    if (createdConnection === undefined) {
      throw new Error("Failed to create Slack integration connection.");
    }

    const webhookSourceCapability = definition.webhookSource;
    if (
      webhookSourceCapability?.lifecycle === IntegrationWebhookSourceLifecycles.IMPLICIT &&
      ((await webhookSourceCapability.supportsConnection?.({
        connection: {
          id: createdConnection.id,
          status: createdConnection.status,
          config: {
            connection_method: SlackConnectionMethodId,
          },
        },
      })) ??
        true)
    ) {
      await ensureImplicitConnectionWebhookSource({
        db: tx,
        organizationId: input.organizationId,
        connectionId: createdConnection.id,
        targetKey: input.targetKey,
      });
    }

    return buildIntegrationConnectionResponse({
      connection: createdConnection,
    });
  });
}
