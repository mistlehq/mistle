import { AppIds, loadConfig } from "@mistle/config";

import type { ControlPlaneWorkerConfig, ControlPlaneWorkerGlobalConfig } from "./types.js";

export type LoadedControlPlaneWorkerConfig = {
  appConfig: ControlPlaneWorkerConfig;
  globalConfig: ControlPlaneWorkerGlobalConfig;
};

let loadedControlPlaneWorkerConfig: LoadedControlPlaneWorkerConfig | undefined;

export function getControlPlaneWorkerConfig(): LoadedControlPlaneWorkerConfig {
  if (loadedControlPlaneWorkerConfig !== undefined) {
    return loadedControlPlaneWorkerConfig;
  }

  const loadedConfig = loadConfig({
    app: AppIds.CONTROL_PLANE_WORKER,
    env: process.env,
  });

  if (loadedConfig.global === undefined) {
    throw new Error("Expected global config to be loaded for control-plane-worker.");
  }

  loadedControlPlaneWorkerConfig = {
    appConfig: loadedConfig.app,
    globalConfig: loadedConfig.global,
  };

  return loadedControlPlaneWorkerConfig;
}
