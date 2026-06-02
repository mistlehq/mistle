import { getDataPlaneDatabaseSchema, type DataPlaneDatabase } from "@mistle/db/data-plane";
import type { Clock } from "@mistle/time";
import { asc, inArray, lt } from "drizzle-orm";

import type { MaintenanceCommandDefinition, MaintenanceCommandResult } from "./types.js";

export const PruneSandboxOperationEventsCommandName = "prune-sandbox-operation-events";

const RetentionMs = 14 * 24 * 60 * 60 * 1_000;
const DeleteBatchSize = 500;
const MaxBatchesPerTable = 100;

export const PruneSandboxOperationEventsCommand: MaintenanceCommandDefinition<"data-plane"> = {
  name: PruneSandboxOperationEventsCommandName,
  database: "data-plane",
  execute: pruneSandboxOperationEvents,
};

export async function pruneSandboxOperationEvents(input: {
  db: DataPlaneDatabase;
  clock: Clock;
}): Promise<MaintenanceCommandResult> {
  const createdBefore = new Date(input.clock.nowMs() - RetentionMs).toISOString();
  const result = await deleteOldSandboxOperationEvents({
    db: input.db,
    createdBefore,
  });

  return {
    deletedRowCounts: {
      sandbox_operation_events: result.deletedRows,
    },
    reachedMaxBatches: result.reachedMaxBatches,
  };
}

async function deleteOldSandboxOperationEvents(input: {
  db: DataPlaneDatabase;
  createdBefore: string;
}): Promise<DeleteBatchLoopResult> {
  const tables = getDataPlaneDatabaseSchema(input.db);

  return deleteInBatches({
    selectIds: async () =>
      input.db
        .select({ id: tables.sandboxOperationEvents.id })
        .from(tables.sandboxOperationEvents)
        .where(lt(tables.sandboxOperationEvents.createdAt, input.createdBefore))
        .orderBy(
          asc(tables.sandboxOperationEvents.createdAt),
          asc(tables.sandboxOperationEvents.id),
        )
        .limit(DeleteBatchSize),
    deleteIds: async (ids) =>
      input.db
        .delete(tables.sandboxOperationEvents)
        .where(inArray(tables.sandboxOperationEvents.id, ids))
        .returning({ id: tables.sandboxOperationEvents.id }),
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
