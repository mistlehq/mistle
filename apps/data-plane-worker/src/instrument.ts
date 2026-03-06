import { AppIds, loadConfig } from "@mistle/config";
import { initializeTelemetryFromConfig } from "@mistle/telemetry";

const loadedConfig = loadConfig({
  app: AppIds.DATA_PLANE_WORKER,
  env: process.env,
});

if (loadedConfig.global === undefined) {
  throw new Error("Expected global config to be loaded for data-plane-worker.");
}

export const telemetry = initializeTelemetryFromConfig({
  serviceName: "@mistle/data-plane-worker",
  config: loadedConfig.global.telemetry,
});

export const appConfig = loadedConfig.app;
export const globalConfig = loadedConfig.global;
