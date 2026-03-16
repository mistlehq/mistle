import { initializeTelemetryFromConfig } from "@mistle/telemetry";

import {
  loadDataPlaneWorkerConfig,
  requireDataPlaneWorkerGlobalConfig,
} from "./openworkflow/core/config.js";

const loadedConfig = loadDataPlaneWorkerConfig(process.env);
requireDataPlaneWorkerGlobalConfig(loadedConfig, "data-plane-worker");

export const telemetry = initializeTelemetryFromConfig({
  serviceName: "@mistle/data-plane-worker",
  config: loadedConfig.global.telemetry,
});

export const appConfig = loadedConfig.app;
export const globalConfig = loadedConfig.global;
