import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  IntegrationDeviceAuthorizationAttemptStatuses,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import type { Clock } from "@mistle/time";
import { and, asc, inArray, isNotNull, lt } from "drizzle-orm";

import type { MaintenanceCommandDefinition, MaintenanceCommandResult } from "./types.js";

export const PruneExpiredIntegrationAuthStateCommandName = "prune-expired-integration-auth-state";

const RedirectSessionRetentionGraceMs = 24 * 60 * 60 * 1_000;
const PendingDeviceAttemptRetentionGraceMs = 24 * 60 * 60 * 1_000;
const TerminalDeviceAttemptRetentionMs = 30 * 24 * 60 * 60 * 1_000;
const DeleteBatchSize = 500;
const MaxBatchesPerTable = 100;

export const PruneExpiredIntegrationAuthStateCommand: MaintenanceCommandDefinition = {
  name: PruneExpiredIntegrationAuthStateCommandName,
  execute: pruneExpiredIntegrationAuthState,
};

export async function pruneExpiredIntegrationAuthState(input: {
  db: ControlPlaneDatabase;
  clock: Clock;
}): Promise<MaintenanceCommandResult> {
  const redirectExpiresBefore = new Date(
    input.clock.nowMs() - RedirectSessionRetentionGraceMs,
  ).toISOString();
  const pendingDeviceExpiresBefore = new Date(
    input.clock.nowMs() - PendingDeviceAttemptRetentionGraceMs,
  ).toISOString();
  const terminalUpdatedBefore = new Date(
    input.clock.nowMs() - TerminalDeviceAttemptRetentionMs,
  ).toISOString();

  const integrationRedirectSessionsResult = await deleteExpiredIntegrationRedirectSessions({
    db: input.db,
    expiresBefore: redirectExpiresBefore,
  });
  const identityLinkRedirectSessionsResult = await deleteExpiredIdentityLinkRedirectSessions({
    db: input.db,
    expiresBefore: redirectExpiresBefore,
  });
  const terminalDeviceAttemptsResult = await deleteTerminalDeviceAuthorizationAttempts({
    db: input.db,
    updatedBefore: terminalUpdatedBefore,
  });
  const pendingDeviceAttemptsResult = await deleteExpiredPendingDeviceAuthorizationAttempts({
    db: input.db,
    expiresBefore: pendingDeviceExpiresBefore,
  });

  return {
    deletedRowCounts: {
      integration_connection_redirect_sessions: integrationRedirectSessionsResult.deletedRows,
      identity_link_redirect_sessions: identityLinkRedirectSessionsResult.deletedRows,
      integration_connection_device_authorization_attempts_terminal:
        terminalDeviceAttemptsResult.deletedRows,
      integration_connection_device_authorization_attempts_pending_expired:
        pendingDeviceAttemptsResult.deletedRows,
    },
    reachedMaxBatches:
      integrationRedirectSessionsResult.reachedMaxBatches ||
      identityLinkRedirectSessionsResult.reachedMaxBatches ||
      terminalDeviceAttemptsResult.reachedMaxBatches ||
      pendingDeviceAttemptsResult.reachedMaxBatches,
  };
}

async function deleteExpiredIntegrationRedirectSessions(input: {
  db: ControlPlaneDatabase;
  expiresBefore: string;
}): Promise<DeleteBatchLoopResult> {
  const tables = getControlPlaneDatabaseSchema(input.db);

  return deleteInBatches({
    selectIds: async () =>
      input.db
        .select({ id: tables.integrationConnectionRedirectSessions.id })
        .from(tables.integrationConnectionRedirectSessions)
        .where(lt(tables.integrationConnectionRedirectSessions.expiresAt, input.expiresBefore))
        .orderBy(
          asc(tables.integrationConnectionRedirectSessions.expiresAt),
          asc(tables.integrationConnectionRedirectSessions.id),
        )
        .limit(DeleteBatchSize),
    deleteIds: async (ids) =>
      input.db
        .delete(tables.integrationConnectionRedirectSessions)
        .where(inArray(tables.integrationConnectionRedirectSessions.id, ids))
        .returning({ id: tables.integrationConnectionRedirectSessions.id }),
  });
}

async function deleteExpiredIdentityLinkRedirectSessions(input: {
  db: ControlPlaneDatabase;
  expiresBefore: string;
}): Promise<DeleteBatchLoopResult> {
  const tables = getControlPlaneDatabaseSchema(input.db);

  return deleteInBatches({
    selectIds: async () =>
      input.db
        .select({ id: tables.identityLinkRedirectSessions.id })
        .from(tables.identityLinkRedirectSessions)
        .where(lt(tables.identityLinkRedirectSessions.expiresAt, input.expiresBefore))
        .orderBy(
          asc(tables.identityLinkRedirectSessions.expiresAt),
          asc(tables.identityLinkRedirectSessions.id),
        )
        .limit(DeleteBatchSize),
    deleteIds: async (ids) =>
      input.db
        .delete(tables.identityLinkRedirectSessions)
        .where(inArray(tables.identityLinkRedirectSessions.id, ids))
        .returning({ id: tables.identityLinkRedirectSessions.id }),
  });
}

async function deleteTerminalDeviceAuthorizationAttempts(input: {
  db: ControlPlaneDatabase;
  updatedBefore: string;
}): Promise<DeleteBatchLoopResult> {
  const tables = getControlPlaneDatabaseSchema(input.db);

  return deleteInBatches({
    selectIds: async () =>
      input.db
        .select({ id: tables.integrationConnectionDeviceAuthorizationAttempts.id })
        .from(tables.integrationConnectionDeviceAuthorizationAttempts)
        .where(
          and(
            inArray(tables.integrationConnectionDeviceAuthorizationAttempts.status, [
              IntegrationDeviceAuthorizationAttemptStatuses.COMPLETED,
              IntegrationDeviceAuthorizationAttemptStatuses.FAILED,
              IntegrationDeviceAuthorizationAttemptStatuses.CANCELLED,
            ]),
            lt(
              tables.integrationConnectionDeviceAuthorizationAttempts.updatedAt,
              input.updatedBefore,
            ),
          ),
        )
        .orderBy(
          asc(tables.integrationConnectionDeviceAuthorizationAttempts.updatedAt),
          asc(tables.integrationConnectionDeviceAuthorizationAttempts.id),
        )
        .limit(DeleteBatchSize),
    deleteIds: async (ids) =>
      input.db
        .delete(tables.integrationConnectionDeviceAuthorizationAttempts)
        .where(inArray(tables.integrationConnectionDeviceAuthorizationAttempts.id, ids))
        .returning({ id: tables.integrationConnectionDeviceAuthorizationAttempts.id }),
  });
}

async function deleteExpiredPendingDeviceAuthorizationAttempts(input: {
  db: ControlPlaneDatabase;
  expiresBefore: string;
}): Promise<DeleteBatchLoopResult> {
  const tables = getControlPlaneDatabaseSchema(input.db);

  return deleteInBatches({
    selectIds: async () =>
      input.db
        .select({ id: tables.integrationConnectionDeviceAuthorizationAttempts.id })
        .from(tables.integrationConnectionDeviceAuthorizationAttempts)
        .where(
          and(
            inArray(tables.integrationConnectionDeviceAuthorizationAttempts.status, [
              IntegrationDeviceAuthorizationAttemptStatuses.PENDING,
            ]),
            isNotNull(tables.integrationConnectionDeviceAuthorizationAttempts.expiresAt),
            lt(
              tables.integrationConnectionDeviceAuthorizationAttempts.expiresAt,
              input.expiresBefore,
            ),
          ),
        )
        .orderBy(
          asc(tables.integrationConnectionDeviceAuthorizationAttempts.expiresAt),
          asc(tables.integrationConnectionDeviceAuthorizationAttempts.id),
        )
        .limit(DeleteBatchSize),
    deleteIds: async (ids) =>
      input.db
        .delete(tables.integrationConnectionDeviceAuthorizationAttempts)
        .where(inArray(tables.integrationConnectionDeviceAuthorizationAttempts.id, ids))
        .returning({ id: tables.integrationConnectionDeviceAuthorizationAttempts.id }),
  });
}

type DeleteBatchLoopResult = {
  deletedRows: number;
  reachedMaxBatches: boolean;
};

async function deleteInBatches(input: {
  selectIds: () => Promise<Array<{ id: string }>>;
  deleteIds: (ids: string[]) => Promise<Array<{ id: string }>>;
}): Promise<DeleteBatchLoopResult> {
  let deletedRows = 0;

  for (let batchIndex = 0; batchIndex < MaxBatchesPerTable; batchIndex += 1) {
    const rows = await input.selectIds();
    if (rows.length === 0) {
      return {
        deletedRows,
        reachedMaxBatches: false,
      };
    }

    const deleted = await input.deleteIds(rows.map((row) => row.id));
    deletedRows += deleted.length;

    if (rows.length < DeleteBatchSize) {
      return {
        deletedRows,
        reachedMaxBatches: false,
      };
    }
  }

  return {
    deletedRows,
    reachedMaxBatches: true,
  };
}
