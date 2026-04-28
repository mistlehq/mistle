import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { Clock } from "@mistle/time";

export type MaintenanceCommandContext = {
  db: ControlPlaneDatabase;
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
