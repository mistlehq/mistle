import type { z } from "zod";

import { readFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";

import { controlPlaneApiConfigModule } from "./apps/control-plane-api/index.js";
import { controlPlaneWorkerConfigModule } from "./apps/control-plane-worker/index.js";
import { dataPlaneApiConfigModule } from "./apps/data-plane-api/index.js";
import { dataPlaneWorkerConfigModule } from "./apps/data-plane-worker/index.js";
import { mergeConfigRoots } from "./core/merge.js";
import { type ConfigModule } from "./core/module.js";
import { asObjectRecord, getValueAtPath } from "./core/record.js";
import { globalConfigModule } from "./global/index.js";
import {
  AppIds,
  appConfigModules,
  type AppConfigModuleKey,
  type AppConfigModuleValue,
} from "./modules.js";
import { loadFromEnv, loadFromToml, validateModules } from "./pipeline.js";
import { type AppConfig, ConfigSchema } from "./schema.js";

type LoadConfigSourceOptions = {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
};

export type LoadConfigOptions<TApp extends AppConfigModuleKey = AppConfigModuleKey> =
  LoadConfigSourceOptions & {
    app: TApp;
    includeGlobal?: boolean;
  };

export type LoadConfigResult<TApp extends AppConfigModuleKey = AppConfigModuleKey> = {
  app: AppConfigModuleValue<TApp>;
  global?: AppConfig["global"];
};

function resolveConfigPath(options: LoadConfigSourceOptions): string | undefined {
  return options.configPath ?? options.env?.MISTLE_CONFIG_PATH;
}

function resolveLoadInputs(options: LoadConfigSourceOptions): {
  configPath?: string;
  env: NodeJS.ProcessEnv;
} {
  if (options.configPath === undefined && options.env === undefined) {
    throw new Error(
      "Missing config source. Provide at least one of loadConfig({ configPath, ... }) or loadConfig({ env, ... }).",
    );
  }

  const env = options.env ?? {};
  const configPath = resolveConfigPath(options);

  if (configPath === undefined) {
    return { env };
  }

  return { configPath, env };
}

function parseModuleValue<TSchema extends z.ZodType>(
  module: ConfigModule<TSchema>,
  root: Record<string, unknown>,
): z.output<TSchema> {
  return module.schema.parse(getValueAtPath(root, module.namespace));
}

function loadValidatedRoot(
  modules: readonly ConfigModule[],
  options: LoadConfigSourceOptions,
): Record<string, unknown> {
  const { configPath, env } = resolveLoadInputs(options);

  const parsedTomlRoot =
    configPath === undefined ? {} : asObjectRecord(parseToml(readFileSync(configPath, "utf8")));

  const tomlLoadedRoot = loadFromToml(modules, parsedTomlRoot);
  const envLoadedRoot = loadFromEnv(modules, env);
  const mergedRoot = mergeConfigRoots(tomlLoadedRoot, envLoadedRoot);
  return validateModules(modules, mergedRoot);
}

export function parseConfigRecord(record: unknown): AppConfig {
  return ConfigSchema.parse(record);
}

function parseAppConfig(
  appId: typeof AppIds.CONTROL_PLANE_API,
  root: Record<string, unknown>,
): AppConfigModuleValue<typeof AppIds.CONTROL_PLANE_API>;
function parseAppConfig(
  appId: typeof AppIds.CONTROL_PLANE_WORKER,
  root: Record<string, unknown>,
): AppConfigModuleValue<typeof AppIds.CONTROL_PLANE_WORKER>;
function parseAppConfig(
  appId: typeof AppIds.DATA_PLANE_API,
  root: Record<string, unknown>,
): AppConfigModuleValue<typeof AppIds.DATA_PLANE_API>;
function parseAppConfig(
  appId: typeof AppIds.DATA_PLANE_WORKER,
  root: Record<string, unknown>,
): AppConfigModuleValue<typeof AppIds.DATA_PLANE_WORKER>;
function parseAppConfig<TApp extends AppConfigModuleKey>(
  appId: TApp,
  root: Record<string, unknown>,
): AppConfigModuleValue<TApp>;
function parseAppConfig(
  appId: AppConfigModuleKey,
  root: Record<string, unknown>,
): AppConfigModuleValue<AppConfigModuleKey> {
  if (appId === AppIds.CONTROL_PLANE_API) {
    return parseModuleValue(controlPlaneApiConfigModule, root);
  }

  if (appId === AppIds.CONTROL_PLANE_WORKER) {
    return parseModuleValue(controlPlaneWorkerConfigModule, root);
  }

  if (appId === AppIds.DATA_PLANE_API) {
    return parseModuleValue(dataPlaneApiConfigModule, root);
  }

  return parseModuleValue(dataPlaneWorkerConfigModule, root);
}

export function loadConfig<TApp extends AppConfigModuleKey>(
  options: LoadConfigOptions<TApp>,
): LoadConfigResult<TApp> {
  const appModule = appConfigModules[options.app];

  if (options.includeGlobal === false) {
    const validatedRoot = loadValidatedRoot([appModule], options);
    const appConfig = parseAppConfig(options.app, validatedRoot);
    return {
      app: appConfig,
    };
  }

  const validatedRoot = loadValidatedRoot([globalConfigModule, appModule], options);
  const appConfig = parseAppConfig(options.app, validatedRoot);
  return {
    global: parseModuleValue(globalConfigModule, validatedRoot),
    app: appConfig,
  };
}
