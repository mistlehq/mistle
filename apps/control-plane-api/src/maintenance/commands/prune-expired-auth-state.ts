import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import type { Clock } from "@mistle/time";
import { asc, inArray, lt } from "drizzle-orm";

import type { MaintenanceCommandDefinition, MaintenanceCommandResult } from "./types.js";

export const PruneExpiredAuthStateCommandName = "prune-expired-auth-state";

const RetentionGraceMs = 24 * 60 * 60 * 1_000;
const DeleteBatchSize = 500;
const MaxBatchesPerTable = 100;

export const PruneExpiredAuthStateCommand: MaintenanceCommandDefinition = {
  name: PruneExpiredAuthStateCommandName,
  execute: pruneExpiredAuthState,
};

export async function pruneExpiredAuthState(input: {
  db: ControlPlaneDatabase;
  clock: Clock;
}): Promise<MaintenanceCommandResult> {
  const expiresBefore = new Date(input.clock.nowMs() - RetentionGraceMs);
  const verificationResult = await deleteExpiredVerifications({
    db: input.db,
    expiresBefore,
  });
  const sessionResult = await deleteExpiredSessions({
    db: input.db,
    expiresBefore,
  });

  return {
    deletedRowCounts: {
      verifications: verificationResult.deletedRows,
      sessions: sessionResult.deletedRows,
    },
    reachedMaxBatches: verificationResult.reachedMaxBatches || sessionResult.reachedMaxBatches,
  };
}

async function deleteExpiredVerifications(input: {
  db: ControlPlaneDatabase;
  expiresBefore: Date;
}): Promise<DeleteBatchLoopResult> {
  const tables = getControlPlaneDatabaseSchema(input.db);

  return deleteInBatches({
    selectIds: async () =>
      input.db
        .select({ id: tables.verifications.id })
        .from(tables.verifications)
        .where(lt(tables.verifications.expiresAt, input.expiresBefore))
        .orderBy(asc(tables.verifications.expiresAt), asc(tables.verifications.id))
        .limit(DeleteBatchSize),
    deleteIds: async (ids) =>
      input.db
        .delete(tables.verifications)
        .where(inArray(tables.verifications.id, ids))
        .returning({ id: tables.verifications.id }),
  });
}

async function deleteExpiredSessions(input: {
  db: ControlPlaneDatabase;
  expiresBefore: Date;
}): Promise<DeleteBatchLoopResult> {
  const tables = getControlPlaneDatabaseSchema(input.db);

  return deleteInBatches({
    selectIds: async () =>
      input.db
        .select({ id: tables.sessions.id })
        .from(tables.sessions)
        .where(lt(tables.sessions.expiresAt, input.expiresBefore))
        .orderBy(asc(tables.sessions.expiresAt), asc(tables.sessions.id))
        .limit(DeleteBatchSize),
    deleteIds: async (ids) =>
      input.db
        .delete(tables.sessions)
        .where(inArray(tables.sessions.id, ids))
        .returning({ id: tables.sessions.id }),
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
