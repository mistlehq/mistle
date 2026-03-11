import { initializeTelemetryFromConfig } from "@mistle/telemetry";

import { getDataPlaneWorkerConfig } from "./config.js";

const { appConfig, globalConfig } = getDataPlaneWorkerConfig();

export const telemetry = initializeTelemetryFromConfig({
  serviceName: "@mistle/data-plane-worker",
  config: globalConfig.telemetry,
});

export { appConfig, globalConfig };
