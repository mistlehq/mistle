import { AppIds, type loadConfig } from "@mistle/config";

type LoadControlPlaneWorkerConfigResult = ReturnType<
  typeof loadConfig<typeof AppIds.CONTROL_PLANE_WORKER>
>;

export type ControlPlaneWorkerConfig = LoadControlPlaneWorkerConfigResult["app"];
export type ControlPlaneWorkerGlobalConfig = NonNullable<
  LoadControlPlaneWorkerConfigResult["global"]
>;
