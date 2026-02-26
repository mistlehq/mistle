import type { z } from "zod";

import type { ConfigModule } from "./core/module.js";

import { controlPlaneApiConfigModule } from "./apps/control-plane-api/index.js";
import { controlPlaneWorkerConfigModule } from "./apps/control-plane-worker/index.js";
import { dataPlaneApiConfigModule } from "./apps/data-plane-api/index.js";
import { globalConfigModule } from "./global/index.js";

export const AppIds = {
  CONTROL_PLANE_API: "control-plane-api",
  CONTROL_PLANE_WORKER: "control-plane-worker",
  DATA_PLANE_API: "data-plane-api",
} as const;

export type AppConfigModuleKey = (typeof AppIds)[keyof typeof AppIds];

export const appConfigModules = {
  [AppIds.CONTROL_PLANE_API]: controlPlaneApiConfigModule,
  [AppIds.CONTROL_PLANE_WORKER]: controlPlaneWorkerConfigModule,
  [AppIds.DATA_PLANE_API]: dataPlaneApiConfigModule,
} as const;

export type AppConfigModuleRecord = typeof appConfigModules;
type AppConfigById = {
  [AppIds.CONTROL_PLANE_API]: z.infer<typeof controlPlaneApiConfigModule.schema>;
  [AppIds.CONTROL_PLANE_WORKER]: z.infer<typeof controlPlaneWorkerConfigModule.schema>;
  [AppIds.DATA_PLANE_API]: z.infer<typeof dataPlaneApiConfigModule.schema>;
};

export type AppConfigModuleValue<TApp extends AppConfigModuleKey> = AppConfigById[TApp];

export const configModules: readonly ConfigModule[] = [
  globalConfigModule,
  ...Object.values(appConfigModules),
];
