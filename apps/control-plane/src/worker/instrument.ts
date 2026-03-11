import { initializeTelemetryFromConfig } from "@mistle/telemetry";

import { getControlPlaneWorkerConfig } from "./config.js";

const { appConfig, globalConfig } = getControlPlaneWorkerConfig();

export const telemetry = initializeTelemetryFromConfig({
  serviceName: "@mistle/control-plane-worker",
  config: globalConfig.telemetry,
});

export { appConfig, globalConfig };
