import {
  integrationConnections,
  type ControlPlaneDatabase,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import {
  IntegrationFormConnectionMethodCreateBehaviors,
  IntegrationWebhookSourceLifecycles,
  type IntegrationConnectionMethodId,
  type IntegrationRegistry,
} from "@mistle/integrations-core";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";
import { buildIntegrationConnectionResponse } from "./build-integration-connection-response.js";
import { resolveFormConnectionMethodOrThrow } from "./form-connection-methods.js";
import { ensureImplicitConnectionWebhookSource } from "./webhook-sources.js";

type CreateDraftFormConnectionInput = {
  organizationId: string;
  targetKey: string;
  methodId: IntegrationConnectionMethodId;
  displayName: string;
};

export async function createDraftFormConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: CreateDraftFormConnectionInput,
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

  const formMethod = resolveFormConnectionMethodOrThrow({
    targetKey: input.targetKey,
    methodId: input.methodId,
    connectionMethods: definition.connectionMethods,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
  });

  if (
    formMethod.createBehavior !== IntegrationFormConnectionMethodCreateBehaviors.DRAFT_THEN_SETUP
  ) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_METHOD_NOT_SUPPORTED,
      `Integration connection method '${input.methodId}' does not support draft creation.`,
    );
  }

  return await ctx.db.transaction(async (tx) => {
    const config = {
      connection_method: input.methodId,
    };
    const [createdConnection] = await tx
      .insert(integrationConnections)
      .values({
        organizationId: input.organizationId,
        targetKey: input.targetKey,
        displayName: input.displayName,
        status: IntegrationConnectionStatuses.ACTIVE,
        config,
        targetSnapshotConfig: target.config,
      })
      .returning();

    if (createdConnection === undefined) {
      throw new Error("Failed to create draft integration connection.");
    }

    const webhookSourceCapability = definition.webhookSource;
    if (
      webhookSourceCapability?.lifecycle === IntegrationWebhookSourceLifecycles.IMPLICIT &&
      ((await webhookSourceCapability.supportsConnection?.({
        connection: {
          id: createdConnection.id,
          status: createdConnection.status,
          config,
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
