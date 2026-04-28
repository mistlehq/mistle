import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { sessions, verifications } from "@mistle/db/control-plane";
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
  return deleteInBatches({
    selectIds: async () =>
      input.db
        .select({ id: verifications.id })
        .from(verifications)
        .where(lt(verifications.expiresAt, input.expiresBefore))
        .orderBy(asc(verifications.expiresAt), asc(verifications.id))
        .limit(DeleteBatchSize),
    deleteIds: async (ids) =>
      input.db
        .delete(verifications)
        .where(inArray(verifications.id, ids))
        .returning({ id: verifications.id }),
  });
}

async function deleteExpiredSessions(input: {
  db: ControlPlaneDatabase;
  expiresBefore: Date;
}): Promise<DeleteBatchLoopResult> {
  return deleteInBatches({
    selectIds: async () =>
      input.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(lt(sessions.expiresAt, input.expiresBefore))
        .orderBy(asc(sessions.expiresAt), asc(sessions.id))
        .limit(DeleteBatchSize),
    deleteIds: async (ids) =>
      input.db.delete(sessions).where(inArray(sessions.id, ids)).returning({ id: sessions.id }),
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
