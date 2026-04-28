import { initializeTelemetryFromConfig } from "@mistle/telemetry";

import { loadDataPlaneWorkerConfig } from "./openworkflow/core/config.js";

const loadedConfig = loadDataPlaneWorkerConfig(process.env);

export const telemetry = initializeTelemetryFromConfig({
  serviceName: "@mistle/data-plane-worker",
  config: loadedConfig.app.telemetry,
});

export const appConfig = loadedConfig.app;
