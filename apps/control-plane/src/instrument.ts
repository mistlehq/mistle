import { AppIds, loadConfig } from "@mistle/config";
import { initializeTelemetryFromConfig } from "@mistle/telemetry";

const loadedConfig = loadConfig({
  app: AppIds.CONTROL_PLANE_API,
  env: process.env,
});

if (loadedConfig.global === undefined) {
  throw new Error("Expected global config to be loaded for control-plane-api.");
}

export const telemetry = initializeTelemetryFromConfig({
  serviceName: "@mistle/control-plane-api",
  config: loadedConfig.global.telemetry,
});

export const appConfig = loadedConfig.app;
export const globalConfig = loadedConfig.global;
