import type { AppRuntimeResources } from "../runtime/resources.js";
import type { DataPlaneApiConfig, DataPlaneApiGlobalConfig } from "../types.js";

export interface DataPlaneTrpcContext {
  config: DataPlaneApiConfig;
  internalAuthServiceToken: string;
  sandboxProvider: DataPlaneApiGlobalConfig["sandbox"]["provider"];
  requestHeaders: Headers;
  resources: AppRuntimeResources;
}

export function createDataPlaneTrpcContext(context: DataPlaneTrpcContext): DataPlaneTrpcContext {
  return context;
}
