import { controlPlaneApiDevelopmentPreset } from "./control-plane-api.mjs";
import { controlPlaneWorkerDevelopmentPreset } from "./control-plane-worker.mjs";
import { globalDevelopmentPreset } from "./global.mjs";

export const developmentPresetModules = [
  globalDevelopmentPreset,
  controlPlaneApiDevelopmentPreset,
  controlPlaneWorkerDevelopmentPreset,
];
