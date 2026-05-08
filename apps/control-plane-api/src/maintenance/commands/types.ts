import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { Clock } from "@mistle/time";
import type { Pool } from "pg";

export type MaintenanceCommandContext = {
  db: ControlPlaneDatabase;
  controlPlanePool: Pool;
  dataPlanePool?: Pool;
  clock: Clock;
};

export type MaintenanceCommandResult = {
  deletedRowCounts: Record<string, number>;
  reachedMaxBatches: boolean;
};

export type MaintenanceCommandDefinition = {
  name: string;
  execute: (ctx: MaintenanceCommandContext) => Promise<MaintenanceCommandResult>;
};
