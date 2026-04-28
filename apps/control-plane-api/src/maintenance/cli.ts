import { loadControlPlaneMaintenanceConfig } from "@mistle/config";
import { initializeTelemetryFromConfig, shutdownTelemetry } from "@mistle/telemetry";
import { Pool } from "pg";

import { logger } from "../logger.js";
import { resolveMaintenanceCommand } from "./commands/index.js";
import { runMaintenanceCommand } from "./shared/run-maintenance-command.js";

let telemetryInitialized = false;

async function main(): Promise<void> {
  const commandName = process.argv[2];
  if (commandName === undefined) {
    throw new Error("Expected a maintenance command name.");
  }

  const loadedConfig = loadControlPlaneMaintenanceConfig({
    env: process.env,
  });
  initializeTelemetryFromConfig({
    serviceName: "@mistle/control-plane-api/maintenance",
    config: loadedConfig.app.telemetry,
  });
  telemetryInitialized = true;
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
    await shutdownInitializedTelemetry();
  })
  .catch(async (error) => {
    logger.error({ err: error }, "Maintenance command failed.");
    await shutdownInitializedTelemetry();
    process.exit(1);
  });

async function shutdownInitializedTelemetry(): Promise<void> {
  if (!telemetryInitialized) {
    return;
  }

  await shutdownTelemetry();
}
