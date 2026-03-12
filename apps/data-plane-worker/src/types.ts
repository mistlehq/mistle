import { AppIds, type loadConfig } from "@mistle/config";

type LoadDataPlaneWorkerConfigResult = ReturnType<
  typeof loadConfig<typeof AppIds.DATA_PLANE_WORKER>
>;

export type DataPlaneWorkerConfig = LoadDataPlaneWorkerConfigResult["app"];
export type DataPlaneWorkerGlobalConfig = NonNullable<LoadDataPlaneWorkerConfigResult["global"]>;
export type DataPlaneWorkerRuntimeConfig = {
  app: DataPlaneWorkerConfig;
  sandbox: DataPlaneWorkerGlobalConfig["sandbox"];
  telemetry: DataPlaneWorkerGlobalConfig["telemetry"];
};
