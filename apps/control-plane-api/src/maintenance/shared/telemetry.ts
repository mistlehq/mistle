import { metrics } from "@opentelemetry/api";

import type { MaintenanceCommandResult } from "../commands/types.js";

const MaintenanceMeter = metrics.getMeter("@mistle/control-plane-api/maintenance");

const MaintenanceCommandCompleted = MaintenanceMeter.createCounter(
  "mistle.maintenance.command.completed",
  {
    description: "Number of completed maintenance command runs.",
  },
);

const MaintenanceCommandDurationMs = MaintenanceMeter.createHistogram(
  "mistle.maintenance.command.duration_ms",
  {
    description: "Maintenance command run duration in milliseconds.",
    unit: "ms",
  },
);

const MaintenanceDeletedRows = MaintenanceMeter.createCounter("mistle.maintenance.deleted_rows", {
  description: "Rows deleted by maintenance commands.",
});

const MaintenanceMaxBatchesReached = MaintenanceMeter.createCounter(
  "mistle.maintenance.max_batches_reached",
  {
    description: "Maintenance command table scans that reached their maximum batch limit.",
  },
);

export function recordMaintenanceCommandCompleted(input: {
  commandName: string;
  durationMs: number;
  result: MaintenanceCommandResult;
}): void {
  MaintenanceCommandCompleted.add(1, {
    command: input.commandName,
  });
  MaintenanceCommandDurationMs.record(input.durationMs, {
    command: input.commandName,
  });

  for (const [table, deletedRows] of Object.entries(input.result.deletedRowCounts)) {
    MaintenanceDeletedRows.add(deletedRows, {
      command: input.commandName,
      table,
    });
  }

  if (input.result.reachedMaxBatches) {
    MaintenanceMaxBatchesReached.add(1, {
      command: input.commandName,
    });
  }
}
