import { loadControlPlaneMaintenanceConfig } from "@mistle/config";
import { shutdownTelemetry } from "@mistle/telemetry";
import { Pool } from "pg";

import { logger } from "../logger.js";
import { resolveMaintenanceCommand } from "./commands/index.js";
import { runMaintenanceCommand } from "./shared/run-maintenance-command.js";

async function main(): Promise<void> {
  const commandName = process.argv[2];
  if (commandName === undefined) {
    throw new Error("Expected a maintenance command name.");
  }

  const loadedConfig = loadControlPlaneMaintenanceConfig({
    env: process.env,
  });
  const command = resolveMaintenanceCommand(commandName);
  const pool = new Pool({
    connectionString: loadedConfig.app.database.migrationUrl,
  });

  try {
    const result = await runMaintenanceCommand({
      command,
      pool,
    });
    logger.info(
      {
        command: command.name,
        deletedRowCounts: result.deletedRowCounts,
        reachedMaxBatches: result.reachedMaxBatches,
      },
      "Maintenance command completed.",
    );
  } finally {
    await pool.end();
  }
}

void main()
  .then(async () => {
    await shutdownTelemetry();
  })
  .catch(async (error) => {
    logger.error({ err: error }, "Maintenance command failed.");
    await shutdownTelemetry();
    process.exit(1);
  });
