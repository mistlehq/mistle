import type { z } from "zod";

import type { ConfigModule } from "./core/module.js";

import { controlPlaneApiConfigModule } from "./apps/control-plane-api/index.js";
import { globalConfigModule } from "./global/index.js";

export const AppIds = {
  CONTROL_PLANE_API: "control-plane-api",
} as const;

export type AppConfigModuleKey = (typeof AppIds)[keyof typeof AppIds];

export const appConfigModules = {
  [AppIds.CONTROL_PLANE_API]: controlPlaneApiConfigModule,
} as const;

export type AppConfigModuleRecord = typeof appConfigModules;
export type AppConfigModuleValue<TApp extends AppConfigModuleKey> =
  AppConfigModuleRecord[TApp] extends ConfigModule<infer TSchema> ? z.infer<TSchema> : never;

export const configModules: readonly ConfigModule[] = [
  globalConfigModule,
  ...Object.values(appConfigModules),
];
