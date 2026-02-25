import { controlPlaneApiDevelopmentPreset } from "./control-plane-api.mjs";
import { controlPlaneWorkerDevelopmentPreset } from "./control-plane-worker.mjs";
import { dashboardDevelopmentPreset } from "./dashboard.mjs";
import { globalDevelopmentPreset } from "./global.mjs";

export const developmentPresetModules = [
  globalDevelopmentPreset,
  controlPlaneApiDevelopmentPreset,
  controlPlaneWorkerDevelopmentPreset,
  dashboardDevelopmentPreset,
];
