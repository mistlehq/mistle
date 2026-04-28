import { AppIds, loadConfig } from "@mistle/config";

export type LoadDataPlaneWorkerConfigResult = ReturnType<
  typeof loadConfig<typeof AppIds.DATA_PLANE_WORKER>
>;

export type DataPlaneWorkerConfig = LoadDataPlaneWorkerConfigResult["app"];
export type DataPlaneWorkerRuntimeConfig = {
  app: DataPlaneWorkerConfig;
  sandbox: DataPlaneWorkerConfig["sandbox"];
  telemetry: DataPlaneWorkerConfig["telemetry"];
};

export function loadDataPlaneWorkerConfig(env: NodeJS.ProcessEnv): LoadDataPlaneWorkerConfigResult {
  return loadConfig({
    app: AppIds.DATA_PLANE_WORKER,
    env,
  });
}

export function createDataPlaneWorkerRuntimeConfig(input: {
  app: DataPlaneWorkerConfig;
}): DataPlaneWorkerRuntimeConfig {
  return {
    app: input.app,
    sandbox: input.app.sandbox,
    telemetry: input.app.telemetry,
  };
}
