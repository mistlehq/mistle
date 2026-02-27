import type { AppRuntimeResources } from "../runtime/resources.js";
import type { DataPlaneApiConfig } from "../types.js";

export interface DataPlaneTrpcContext {
  config: DataPlaneApiConfig;
  internalAuthServiceToken: string;
  resources: AppRuntimeResources;
}

export function createDataPlaneTrpcContext(context: DataPlaneTrpcContext): DataPlaneTrpcContext {
  return context;
}
