import {
  integrationConnectionResourceStates,
  type ControlPlaneDatabase,
  type IntegrationConnectionResourceSyncState,
  IntegrationConnectionResourceSyncStates,
} from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { SyncIntegrationConnectionResourcesWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { and, eq, sql } from "drizzle-orm";
import type { OpenWorkflow } from "openworkflow";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../../../integration-connections/constants.js";

export type RequestIntegrationConnectionResourceRefreshInput = {
  organizationId: string;
  connectionId: string;
  kind: string;
};

export type RequestIntegrationConnectionResourceRefreshResult = {
  connectionId: string;
  familyId: string;
  kind: string;
  syncState: typeof IntegrationConnectionResourceSyncStates.SYNCING;
};

type PersistedResourceStateSnapshot = {
  familyId: string;
  kind: string;
  syncState: IntegrationConnectionResourceSyncState;
  lastSyncStartedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

type AcquireResourceSyncAttemptResult =
  | {
      alreadySyncing: true;
    }
  | {
      alreadySyncing: false;
      startedAt: string;
    };

export async function requestIntegrationConnectionResourceRefresh(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    openWorkflow: OpenWorkflow;
  },
  input: RequestIntegrationConnectionResourceRefreshInput,
): Promise<RequestIntegrationConnectionResourceRefreshResult> {
  const { db, integrationRegistry, openWorkflow } = ctx;
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
    throw new NotFoundError(
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
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.RESOURCE_KIND_NOT_SUPPORTED,
      `Resource kind \`${input.kind}\` is not supported for connection \`${connection.id}\`.`,
    );
  }

  const existingState = connection.resourceStates[0];
  const syncAttempt = await acquireResourceSyncAttempt({
    db,
    connectionId: connection.id,
    familyId: target.familyId,
    kind: input.kind,
  });

  if (syncAttempt.alreadySyncing) {
    return {
      connectionId: connection.id,
      familyId: target.familyId,
      kind: input.kind,
      syncState: IntegrationConnectionResourceSyncStates.SYNCING,
    };
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
          startedAt: syncAttempt.startedAt,
        }),
      },
    );
  } catch (error) {
    await restoreResourceStateAfterEnqueueFailure({
      db,
      connectionId: connection.id,
      kind: input.kind,
      previousState: existingState,
    });
    throw error;
  }

  return {
    connectionId: connection.id,
    familyId: target.familyId,
    kind: input.kind,
    syncState: IntegrationConnectionResourceSyncStates.SYNCING,
  };
}

function createResourceSyncIdempotencyKey(input: {
  connectionId: string;
  kind: string;
  startedAt: string;
}): string {
  return `integration-connection-resource-sync:${input.connectionId}:${input.kind}:${input.startedAt}`;
}

async function acquireResourceSyncAttempt(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  familyId: string;
  kind: string;
}): Promise<AcquireResourceSyncAttemptResult> {
  const updatedStates = await input.db
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
      setWhere: sql`${integrationConnectionResourceStates.syncState} <> ${IntegrationConnectionResourceSyncStates.SYNCING}`,
    })
    .returning({
      lastSyncStartedAt: integrationConnectionResourceStates.lastSyncStartedAt,
    });

  const updatedState = updatedStates[0];
  if (updatedState === undefined) {
    return {
      alreadySyncing: true,
    };
  }

  if (updatedState.lastSyncStartedAt === null) {
    throw new Error("Expected acquired resource sync attempt to have a start timestamp.");
  }

  return {
    alreadySyncing: false,
    startedAt: updatedState.lastSyncStartedAt,
  };
}

async function restoreResourceStateAfterEnqueueFailure(input: {
  db: ControlPlaneDatabase;
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
