import { controlPlaneApiDevelopmentPreset } from "./control-plane-api.mjs";
import { controlPlaneWorkerDevelopmentPreset } from "./control-plane-worker.mjs";
import { dashboardDevelopmentPreset } from "./dashboard.mjs";
import { dataPlaneApiDevelopmentPreset } from "./data-plane-api.mjs";
import { dataPlaneWorkerDevelopmentPreset } from "./data-plane-worker.mjs";
import { globalDevelopmentPreset } from "./global.mjs";

export const developmentPresetModules = [
  globalDevelopmentPreset,
  controlPlaneApiDevelopmentPreset,
  controlPlaneWorkerDevelopmentPreset,
  dataPlaneApiDevelopmentPreset,
  dataPlaneWorkerDevelopmentPreset,
  dashboardDevelopmentPreset,
];
