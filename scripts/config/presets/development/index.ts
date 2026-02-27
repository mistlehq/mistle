import { controlPlaneApiDevelopmentPreset } from "./control-plane-api.ts";
import { controlPlaneWorkerDevelopmentPreset } from "./control-plane-worker.ts";
import { dashboardDevelopmentPreset } from "./dashboard.ts";
import { dataPlaneApiDevelopmentPreset } from "./data-plane-api.ts";
import { dataPlaneGatewayDevelopmentPreset } from "./data-plane-gateway.ts";
import { dataPlaneWorkerDevelopmentPreset } from "./data-plane-worker.ts";
import { globalDevelopmentPreset } from "./global.ts";
import type { DevelopmentPresetModule } from "./types.ts";

export const developmentPresetModules: readonly DevelopmentPresetModule[] = [
  globalDevelopmentPreset,
  controlPlaneApiDevelopmentPreset,
  controlPlaneWorkerDevelopmentPreset,
  dataPlaneApiDevelopmentPreset,
  dataPlaneGatewayDevelopmentPreset,
  dataPlaneWorkerDevelopmentPreset,
  dashboardDevelopmentPreset,
];
