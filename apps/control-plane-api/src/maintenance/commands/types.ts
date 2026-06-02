import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { DataPlaneDatabase } from "@mistle/db/data-plane";
import type { Clock } from "@mistle/time";

export type MaintenanceCommandDatabase = "control-plane" | "data-plane";

export type ControlPlaneMaintenanceCommandContext = {
  db: ControlPlaneDatabase;
  clock: Clock;
};

export type DataPlaneMaintenanceCommandContext = {
  db: DataPlaneDatabase;
  clock: Clock;
};

export type MaintenanceCommandContextByDatabase = {
  "control-plane": ControlPlaneMaintenanceCommandContext;
  "data-plane": DataPlaneMaintenanceCommandContext;
};

export type MaintenanceCommandContext =
  MaintenanceCommandContextByDatabase[MaintenanceCommandDatabase];

export type MaintenanceCommandResult = {
  deletedRowCounts: Record<string, number>;
  reachedMaxBatches: boolean;
};

export type MaintenanceCommandDefinitionByDatabase = {
  [TDatabase in MaintenanceCommandDatabase]: {
    name: string;
    database: TDatabase;
    execute: (
      ctx: MaintenanceCommandContextByDatabase[TDatabase],
    ) => Promise<MaintenanceCommandResult>;
  };
};

export type MaintenanceCommandDefinition<
  TDatabase extends MaintenanceCommandDatabase = MaintenanceCommandDatabase,
> = MaintenanceCommandDefinitionByDatabase[TDatabase];
