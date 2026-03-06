import { AppIds, loadConfig } from "@mistle/config";
import { initializeTelemetryFromConfig } from "@mistle/telemetry";

const loadedConfig = loadConfig({
  app: AppIds.TOKENIZER_PROXY,
  env: process.env,
});

if (loadedConfig.global === undefined) {
  throw new Error("Expected global config to be loaded for tokenizer-proxy.");
}

export const telemetry = initializeTelemetryFromConfig({
  serviceName: "@mistle/tokenizer-proxy",
  config: loadedConfig.global.telemetry,
});

export const appConfig = loadedConfig.app;
export const globalConfig = loadedConfig.global;
