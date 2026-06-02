import { createControlPlaneDatabase } from "@mistle/db/control-plane";
import { createDataPlaneDatabase } from "@mistle/db/data-plane";
import { systemClock, type Clock } from "@mistle/time";
import type { Pool } from "pg";

import type { MaintenanceCommandDefinition, MaintenanceCommandResult } from "../commands/types.js";
import { acquireMaintenanceAdvisoryLock, releaseMaintenanceAdvisoryLock } from "./advisory-lock.js";
import { recordMaintenanceCommandCompleted } from "./telemetry.js";

export async function runMaintenanceCommand(input: {
  command: MaintenanceCommandDefinition;
  pool: Pool;
  clock?: Clock;
}): Promise<MaintenanceCommandResult> {
  const clock = input.clock ?? systemClock;
  const lockClient = await input.pool.connect();
  const startedAtMs = clock.nowMs();
  let lockAcquired = false;

  try {
    await acquireMaintenanceAdvisoryLock({
      client: lockClient,
      commandName: input.command.name,
    });
    lockAcquired = true;

    const result =
      input.command.database === "control-plane"
        ? await input.command.execute({
            db: createControlPlaneDatabase(input.pool),
            clock,
          })
        : await input.command.execute({
            db: createDataPlaneDatabase(input.pool),
            clock,
          });

    recordMaintenanceCommandCompleted({
      commandName: input.command.name,
      durationMs: clock.nowMs() - startedAtMs,
      result,
    });

    return result;
  } finally {
    if (lockAcquired) {
      await releaseMaintenanceAdvisoryLock({
        client: lockClient,
        commandName: input.command.name,
      });
    }

    lockClient.release();
  }
}
