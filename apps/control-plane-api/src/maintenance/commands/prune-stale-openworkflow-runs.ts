import type { Clock } from "@mistle/time";
import type { Pool } from "pg";

import type { MaintenanceCommandDefinition, MaintenanceCommandResult } from "./types.js";

export const PruneStaleOpenWorkflowRunsCommandName = "prune-stale-openworkflow-runs";

const RetentionMs = 30 * 24 * 60 * 60 * 1_000;
const DeleteBatchSize = 500;
const MaxBatchesPerSchema = 100;
const TerminalWorkflowRunStatuses = ["completed", "succeeded", "failed", "canceled"];

export const PruneStaleOpenWorkflowRunsCommand: MaintenanceCommandDefinition = {
  name: PruneStaleOpenWorkflowRunsCommandName,
  execute: pruneStaleOpenWorkflowRuns,
};

export async function pruneStaleOpenWorkflowRuns(input: {
  controlPlanePool: Pool;
  dataPlanePool?: Pool;
  clock: Clock;
}): Promise<MaintenanceCommandResult> {
  if (input.dataPlanePool === undefined) {
    throw new Error(
      "Pruning stale OpenWorkflow runs requires MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL.",
    );
  }

  const finishedBefore = new Date(input.clock.nowMs() - RetentionMs);
  const controlPlaneResult = await deleteTerminalWorkflowRuns({
    pool: input.controlPlanePool,
    schemaName: "control_plane_openworkflow",
    finishedBefore,
  });
  const dataPlaneResult = await deleteTerminalWorkflowRuns({
    pool: input.dataPlanePool,
    schemaName: "data_plane_openworkflow",
    finishedBefore,
  });

  return {
    deletedRowCounts: {
      "control_plane_openworkflow.workflow_runs": controlPlaneResult.deletedRows,
      "data_plane_openworkflow.workflow_runs": dataPlaneResult.deletedRows,
    },
    reachedMaxBatches: controlPlaneResult.reachedMaxBatches || dataPlaneResult.reachedMaxBatches,
  };
}

async function deleteTerminalWorkflowRuns(input: {
  pool: Pool;
  schemaName: string;
  finishedBefore: Date;
}): Promise<DeleteBatchLoopResult> {
  const schemaIdentifier = quotePostgresIdentifier(input.schemaName);
  const deleteBatchQuery = `
    with candidates as (
      select wr.namespace_id, wr.id
      from ${schemaIdentifier}."workflow_runs" wr
      where
        wr.status = any($1::text[])
        and wr.finished_at is not null
        and wr.finished_at < $2
        and not exists (
          select 1
          from ${schemaIdentifier}."step_attempts" child_step
          join ${schemaIdentifier}."workflow_runs" parent_run
            on parent_run.namespace_id = child_step.namespace_id
            and parent_run.id = child_step.workflow_run_id
          where
            child_step.child_workflow_run_namespace_id = wr.namespace_id
            and child_step.child_workflow_run_id = wr.id
            and parent_run.status <> all($1::text[])
        )
      order by wr.finished_at asc, wr.namespace_id asc, wr.id asc
      limit $3
      for update skip locked
    ),
    deleted_signals as (
      delete from ${schemaIdentifier}."workflow_signals" workflow_signal
      using candidates
      where
        workflow_signal.namespace_id = candidates.namespace_id
        and workflow_signal.workflow_run_id = candidates.id
      returning workflow_signal.id
    ),
    deleted_runs as (
      delete from ${schemaIdentifier}."workflow_runs" workflow_run
      using candidates
      where
        workflow_run.namespace_id = candidates.namespace_id
        and workflow_run.id = candidates.id
      returning workflow_run.id
    )
    select count(*)::text as deleted_count
    from deleted_runs
  `;
  let deletedRows = 0;

  for (let batchIndex = 0; batchIndex < MaxBatchesPerSchema; batchIndex += 1) {
    const result = await input.pool.query<{ deleted_count: string }>(deleteBatchQuery, [
      TerminalWorkflowRunStatuses,
      input.finishedBefore,
      DeleteBatchSize,
    ]);
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("Expected OpenWorkflow pruning query to return a row.");
    }

    const deletedInBatch = Number.parseInt(row.deleted_count, 10);
    deletedRows += deletedInBatch;

    if (deletedInBatch < DeleteBatchSize) {
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

function quotePostgresIdentifier(identifier: string): string {
  if (!/^[a-zA-Z_]\w*$/u.test(identifier)) {
    throw new Error(`Invalid PostgreSQL identifier '${identifier}'.`);
  }

  return `"${identifier}"`;
}

type DeleteBatchLoopResult = {
  deletedRows: number;
  reachedMaxBatches: boolean;
};
