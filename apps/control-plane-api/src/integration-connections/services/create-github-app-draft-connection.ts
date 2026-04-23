import {
  integrationConnections,
  type ControlPlaneDatabase,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import {
  IntegrationConnectionMethodIds,
  IntegrationWebhookSourceLifecycles,
  type IntegrationRegistry,
} from "@mistle/integrations-core";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";
import { ensureImplicitConnectionWebhookSource } from "./webhook-sources.js";

export type CreateGitHubAppDraftConnectionInput = {
  organizationId: string;
  targetKey: string;
  displayName: string;
};

type CreatedConnection = {
  id: string;
  targetKey: string;
  displayName: string;
  status: "active" | "error" | "revoked";
  externalSubjectId?: string;
  config?: Record<string, unknown>;
  targetSnapshotConfig?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export async function createGitHubAppDraftConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: CreateGitHubAppDraftConnectionInput,
): Promise<CreatedConnection> {
  const { db, integrationRegistry } = ctx;

  const target = await db.query.integrationTargets.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.targetKey, input.targetKey), eq(table.enabled, true)),
  });

  if (target === undefined) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND,
      `Integration target '${input.targetKey}' was not found.`,
    );
  }

  const definition = integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });
  if (definition === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
      `Integration definition '${target.familyId}/${target.variantId}' is not registered.`,
    );
  }

  if (definition.familyId !== "github") {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.GITHUB_APP_INSTALLATION_NOT_SUPPORTED,
      `Integration target '${input.targetKey}' does not support GitHub App installation drafts.`,
    );
  }

  const githubAppMethod = definition.connectionMethods.find(
    (method) => method.id === IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
  );
  if (githubAppMethod === undefined || githubAppMethod.kind !== "form") {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.GITHUB_APP_INSTALLATION_NOT_SUPPORTED,
      `Integration target '${input.targetKey}' does not support GitHub App installation auth.`,
    );
  }

  return await db.transaction(async (tx) => {
    const [createdConnection] = await tx
      .insert(integrationConnections)
      .values({
        organizationId: input.organizationId,
        targetKey: input.targetKey,
        displayName: input.displayName,
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        },
        targetSnapshotConfig: target.config,
      })
      .returning();

    if (createdConnection === undefined) {
      throw new Error("Failed to create integration connection.");
    }

    const webhookSourceCapability = definition.webhookSource;
    if (
      webhookSourceCapability?.lifecycle === IntegrationWebhookSourceLifecycles.IMPLICIT &&
      ((await webhookSourceCapability.supportsConnection?.({
        connection: {
          id: createdConnection.id,
          status: createdConnection.status,
          config: {
            connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
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

    return {
      id: createdConnection.id,
      targetKey: createdConnection.targetKey,
      displayName: createdConnection.displayName,
      status: createdConnection.status,
      ...(createdConnection.externalSubjectId === null
        ? {}
        : { externalSubjectId: createdConnection.externalSubjectId }),
      ...(createdConnection.config === null ? {} : { config: createdConnection.config }),
      ...(createdConnection.targetSnapshotConfig === null
        ? {}
        : { targetSnapshotConfig: createdConnection.targetSnapshotConfig }),
      createdAt: createdConnection.createdAt,
      updatedAt: createdConnection.updatedAt,
    };
  });
}
