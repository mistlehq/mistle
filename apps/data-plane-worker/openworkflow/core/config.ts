import { AppIds, loadConfig } from "@mistle/config";

export type LoadDataPlaneWorkerConfigResult = ReturnType<
  typeof loadConfig<typeof AppIds.DATA_PLANE_WORKER>
>;

export type DataPlaneWorkerConfig = LoadDataPlaneWorkerConfigResult["app"];
export type DataPlaneWorkerGlobalConfig = NonNullable<LoadDataPlaneWorkerConfigResult["global"]>;
export type DataPlaneWorkerRuntimeConfig = {
  app: DataPlaneWorkerConfig;
  sandbox: DataPlaneWorkerGlobalConfig["sandbox"];
  telemetry: DataPlaneWorkerGlobalConfig["telemetry"];
};

export function loadDataPlaneWorkerConfig(env: NodeJS.ProcessEnv): LoadDataPlaneWorkerConfigResult {
  return loadConfig({
    app: AppIds.DATA_PLANE_WORKER,
    env,
  });
}

export function requireDataPlaneWorkerGlobalConfig(
  loadedConfig: LoadDataPlaneWorkerConfigResult,
  consumer: string,
): asserts loadedConfig is LoadDataPlaneWorkerConfigResult & {
  global: DataPlaneWorkerGlobalConfig;
} {
  if (loadedConfig.global === undefined) {
    throw new Error(`Expected global config to be loaded for ${consumer}.`);
  }
}

export function createDataPlaneWorkerRuntimeConfig(input: {
  app: DataPlaneWorkerConfig;
  global: DataPlaneWorkerGlobalConfig;
}): DataPlaneWorkerRuntimeConfig {
  return {
    app: input.app,
    sandbox: input.global.sandbox,
    telemetry: input.global.telemetry,
  };
}
