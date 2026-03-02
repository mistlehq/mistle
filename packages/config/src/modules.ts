import type { z } from "zod";

import { controlPlaneApiConfigModule } from "./apps/control-plane-api/index.js";
import { controlPlaneWorkerConfigModule } from "./apps/control-plane-worker/index.js";
import { dataPlaneApiConfigModule } from "./apps/data-plane-api/index.js";
import { dataPlaneGatewayConfigModule } from "./apps/data-plane-gateway/index.js";
import { dataPlaneWorkerConfigModule } from "./apps/data-plane-worker/index.js";
import { tokenizerProxyConfigModule } from "./apps/tokenizer-proxy/index.js";
import type { ConfigModule } from "./core/module.js";
import { globalConfigModule } from "./global/index.js";

export const AppIds = {
  CONTROL_PLANE_API: "control-plane-api",
  CONTROL_PLANE_WORKER: "control-plane-worker",
  DATA_PLANE_API: "data-plane-api",
  DATA_PLANE_GATEWAY: "data-plane-gateway",
  DATA_PLANE_WORKER: "data-plane-worker",
  TOKENIZER_PROXY: "tokenizer-proxy",
} as const;

export type AppConfigModuleKey = (typeof AppIds)[keyof typeof AppIds];

export const appConfigModules = {
  [AppIds.CONTROL_PLANE_API]: controlPlaneApiConfigModule,
  [AppIds.CONTROL_PLANE_WORKER]: controlPlaneWorkerConfigModule,
  [AppIds.DATA_PLANE_API]: dataPlaneApiConfigModule,
  [AppIds.DATA_PLANE_GATEWAY]: dataPlaneGatewayConfigModule,
  [AppIds.DATA_PLANE_WORKER]: dataPlaneWorkerConfigModule,
  [AppIds.TOKENIZER_PROXY]: tokenizerProxyConfigModule,
} as const;

export type AppConfigModuleRecord = typeof appConfigModules;
type AppConfigById = {
  [AppIds.CONTROL_PLANE_API]: z.infer<typeof controlPlaneApiConfigModule.schema>;
  [AppIds.CONTROL_PLANE_WORKER]: z.infer<typeof controlPlaneWorkerConfigModule.schema>;
  [AppIds.DATA_PLANE_API]: z.infer<typeof dataPlaneApiConfigModule.schema>;
  [AppIds.DATA_PLANE_GATEWAY]: z.infer<typeof dataPlaneGatewayConfigModule.schema>;
  [AppIds.DATA_PLANE_WORKER]: z.infer<typeof dataPlaneWorkerConfigModule.schema>;
  [AppIds.TOKENIZER_PROXY]: z.infer<typeof tokenizerProxyConfigModule.schema>;
};

export type AppConfigModuleValue<TApp extends AppConfigModuleKey> = AppConfigById[TApp];

export const configModules: readonly ConfigModule[] = [
  globalConfigModule,
  ...Object.values(appConfigModules),
];
