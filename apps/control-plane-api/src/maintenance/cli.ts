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
    connectionString:
      command.database === "control-plane"
        ? requireDatabaseUrl({
            commandName: command.name,
            database: command.database,
            url: loadedConfig.app.database.controlPlaneMigrationUrl,
          })
        : requireDatabaseUrl({
            commandName: command.name,
            database: command.database,
            url: loadedConfig.app.database.dataPlaneMigrationUrl,
          }),
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

function requireDatabaseUrl(input: {
  commandName: string;
  database: "control-plane" | "data-plane";
  url: string | undefined;
}): string {
  if (input.url !== undefined) {
    return input.url;
  }

  const envVar =
    input.database === "control-plane"
      ? "MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL"
      : "MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL";
  throw new Error(
    `Maintenance command '${input.commandName}' requires ${input.database} database config. Set ${envVar}.`,
  );
}
