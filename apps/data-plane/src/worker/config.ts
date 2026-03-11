import { AppIds, loadConfig } from "@mistle/config";

import type { DataPlaneWorkerConfig, DataPlaneWorkerGlobalConfig } from "./types.js";

export type LoadedDataPlaneWorkerConfig = {
  appConfig: DataPlaneWorkerConfig;
  globalConfig: DataPlaneWorkerGlobalConfig;
};

let loadedDataPlaneWorkerConfig: LoadedDataPlaneWorkerConfig | undefined;

export function getDataPlaneWorkerConfig(): LoadedDataPlaneWorkerConfig {
  if (loadedDataPlaneWorkerConfig !== undefined) {
    return loadedDataPlaneWorkerConfig;
  }

  const loadedConfig = loadConfig({
    app: AppIds.DATA_PLANE_WORKER,
    env: process.env,
  });

  if (loadedConfig.global === undefined) {
    throw new Error("Expected global config to be loaded for data-plane-worker.");
  }

  loadedDataPlaneWorkerConfig = {
    appConfig: loadedConfig.app,
    globalConfig: loadedConfig.global,
  };

  return loadedDataPlaneWorkerConfig;
}
