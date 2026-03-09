import {
  integrationConnectionResourceStates,
  IntegrationConnectionResourceSyncStates,
} from "@mistle/db/control-plane";
import { SyncIntegrationConnectionResourcesWorkflowSpec } from "@mistle/workflows/control-plane";
import { and, eq, sql } from "drizzle-orm";

import type { AppContext } from "../../types.js";
import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsBadRequestError,
  IntegrationConnectionsNotFoundCodes,
  IntegrationConnectionsNotFoundError,
} from "./errors.js";

export type RequestIntegrationConnectionResourceRefreshInput = {
  organizationId: string;
  connectionId: string;
  kind: string;
};

export type RequestIntegrationConnectionResourceRefreshResult = {
  connectionId: string;
  familyId: string;
  kind: string;
  syncState: "syncing";
};

type IntegrationConnectionResourceSyncState =
  (typeof IntegrationConnectionResourceSyncStates)[keyof typeof IntegrationConnectionResourceSyncStates];

type PersistedResourceStateSnapshot = {
  familyId: string;
  kind: string;
  syncState: IntegrationConnectionResourceSyncState;
  lastSyncStartedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

export async function requestIntegrationConnectionResourceRefresh(
  db: AppContext["var"]["db"],
  integrationRegistry: AppContext["var"]["integrationRegistry"],
  openWorkflow: AppContext["var"]["openWorkflow"],
  input: RequestIntegrationConnectionResourceRefreshInput,
): Promise<RequestIntegrationConnectionResourceRefreshResult> {
  const connection = await db.query.integrationConnections.findFirst({
    columns: {
      id: true,
      organizationId: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.organizationId, input.organizationId), eq(table.id, input.connectionId)),
    with: {
      target: {
        columns: {
          familyId: true,
          variantId: true,
        },
      },
      resourceStates: {
        columns: {
          familyId: true,
          kind: true,
          syncState: true,
          lastSyncStartedAt: true,
          lastErrorCode: true,
          lastErrorMessage: true,
        },
        where: (table, { eq }) => eq(table.kind, input.kind),
      },
    },
  });

  if (connection === undefined) {
    throw new IntegrationConnectionsNotFoundError(
      IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
      "Integration connection was not found.",
    );
  }

  const target = connection.target;
  if (target === null) {
    throw new Error("Expected integration connection target relation to be present.");
  }

  const definition = integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });
  const isSupported = (definition?.resourceDefinitions ?? []).some(
    (resourceDefinition) => resourceDefinition.kind === input.kind,
  );
  if (!isSupported) {
    throw new IntegrationConnectionsBadRequestError(
      IntegrationConnectionsBadRequestCodes.RESOURCE_KIND_NOT_SUPPORTED,
      `Resource kind \`${input.kind}\` is not supported for connection \`${connection.id}\`.`,
    );
  }

  const existingState = connection.resourceStates[0];
  const needsSyncingUpdate =
    existingState === undefined ||
    existingState.syncState !== IntegrationConnectionResourceSyncStates.SYNCING;
  if (needsSyncingUpdate) {
    await setResourceStateSyncing({
      db,
      connectionId: connection.id,
      familyId: target.familyId,
      kind: input.kind,
    });
  }

  try {
    await openWorkflow.runWorkflow(
      SyncIntegrationConnectionResourcesWorkflowSpec,
      {
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        kind: input.kind,
      },
      {
        idempotencyKey: createResourceSyncIdempotencyKey({
          connectionId: input.connectionId,
          kind: input.kind,
        }),
      },
    );
  } catch (error) {
    if (needsSyncingUpdate) {
      await restoreResourceStateAfterEnqueueFailure({
        db,
        connectionId: connection.id,
        kind: input.kind,
        previousState: existingState,
      });
    }
    throw error;
  }

  return {
    connectionId: connection.id,
    familyId: target.familyId,
    kind: input.kind,
    syncState: IntegrationConnectionResourceSyncStates.SYNCING,
  };
}

function createResourceSyncIdempotencyKey(input: { connectionId: string; kind: string }): string {
  return `integration-connection-resource-sync:${input.connectionId}:${input.kind}`;
}

async function setResourceStateSyncing(input: {
  db: AppContext["var"]["db"];
  connectionId: string;
  familyId: string;
  kind: string;
}): Promise<void> {
  await input.db
    .insert(integrationConnectionResourceStates)
    .values({
      connectionId: input.connectionId,
      familyId: input.familyId,
      kind: input.kind,
      syncState: IntegrationConnectionResourceSyncStates.SYNCING,
      lastSyncStartedAt: sql`now()`,
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [
        integrationConnectionResourceStates.connectionId,
        integrationConnectionResourceStates.kind,
      ],
      set: {
        familyId: input.familyId,
        syncState: IntegrationConnectionResourceSyncStates.SYNCING,
        lastSyncStartedAt: sql`now()`,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: sql`now()`,
      },
    });
}

async function restoreResourceStateAfterEnqueueFailure(input: {
  db: AppContext["var"]["db"];
  connectionId: string;
  kind: string;
  previousState: PersistedResourceStateSnapshot | undefined;
}): Promise<void> {
  if (input.previousState === undefined) {
    await input.db
      .delete(integrationConnectionResourceStates)
      .where(
        and(
          eq(integrationConnectionResourceStates.connectionId, input.connectionId),
          eq(integrationConnectionResourceStates.kind, input.kind),
        ),
      );
    return;
  }

  await input.db
    .update(integrationConnectionResourceStates)
    .set({
      familyId: input.previousState.familyId,
      syncState: input.previousState.syncState,
      lastSyncStartedAt: input.previousState.lastSyncStartedAt,
      lastErrorCode: input.previousState.lastErrorCode,
      lastErrorMessage: input.previousState.lastErrorMessage,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(integrationConnectionResourceStates.connectionId, input.connectionId),
        eq(integrationConnectionResourceStates.kind, input.kind),
      ),
    );
}
