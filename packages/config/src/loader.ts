import type { z } from "zod";

import { readFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";

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

export type LoadConfigOptions = {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  app: AppConfigModuleKey;
  includeGlobal?: boolean;
};

export type LoadConfigResult =
  | {
      app: AppConfigModuleValue<typeof AppIds.CONTROL_PLANE_API>;
    }
  | {
      global: AppConfig["global"];
      app: AppConfigModuleValue<typeof AppIds.CONTROL_PLANE_API>;
    };

function resolveConfigPath(options: LoadConfigOptions): string | undefined {
  return options.configPath ?? options.env?.MISTLE_CONFIG_PATH;
}

function resolveLoadInputs(options: LoadConfigOptions): {
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
  options: LoadConfigOptions,
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

export function loadConfig(options: LoadConfigOptions & { includeGlobal: false }): {
  app: AppConfigModuleValue<typeof AppIds.CONTROL_PLANE_API>;
};
export function loadConfig(options: LoadConfigOptions & { includeGlobal?: true }): {
  global: AppConfig["global"];
  app: AppConfigModuleValue<typeof AppIds.CONTROL_PLANE_API>;
};
export function loadConfig(options: LoadConfigOptions): LoadConfigResult {
  const appModule = appConfigModules[options.app];

  if (options.includeGlobal === false) {
    const validatedRoot = loadValidatedRoot([appModule], options);
    const appConfig = parseModuleValue(appModule, validatedRoot);
    return {
      app: appConfig,
    };
  }

  const validatedRoot = loadValidatedRoot([globalConfigModule, appModule], options);
  const appConfig = parseModuleValue(appModule, validatedRoot);
  return {
    global: parseModuleValue(globalConfigModule, validatedRoot),
    app: appConfig,
  };
}
