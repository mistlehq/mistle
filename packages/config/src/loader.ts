import { readFileSync } from "node:fs";

import { parse as parseToml } from "smol-toml";
import type { z } from "zod";

import { controlPlaneApiConfigModule } from "./apps/control-plane-api/index.js";
import { controlPlaneWorkerConfigModule } from "./apps/control-plane-worker/index.js";
import { dataPlaneApiConfigModule } from "./apps/data-plane-api/index.js";
import {
  getDataPlaneApiSandboxProviderValidationIssue,
  PartialDataPlaneApiConfigSchema,
} from "./apps/data-plane-api/schema.js";
import { dataPlaneGatewayConfigModule } from "./apps/data-plane-gateway/index.js";
import { PartialDataPlaneGatewayConfigSchema } from "./apps/data-plane-gateway/schema.js";
import { dataPlaneWorkerConfigModule } from "./apps/data-plane-worker/index.js";
import {
  getDataPlaneWorkerPersistentSandboxValidationIssue,
  getDataPlaneWorkerSandboxProviderValidationIssue,
} from "./apps/data-plane-worker/schema.js";
import { tokenizerProxyConfigModule } from "./apps/tokenizer-proxy/index.js";
import { PartialTokenizerProxyConfigSchema } from "./apps/tokenizer-proxy/schema.js";
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
import { loadFromEnv, validateModules } from "./pipeline.js";
import { type AppConfig, ConfigSchema } from "./schema.js";
import { loadRootConfigFromEnv } from "./toml/load-env.js";
import {
  selectControlPlaneApiConfig,
  selectControlPlaneWorkerConfig,
  selectDataPlaneApiConfig,
  selectDataPlaneGatewayConfig,
  selectDataPlaneWorkerConfig,
  selectGlobalConfig,
  selectTokenizerProxyConfig,
} from "./toml/project.js";
import { ConfigSchema as RootConfigSchema, type Config as RootConfig } from "./toml/schema.js";

export type LoadConfigSourceOptions = {
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

function applyModuleEnvOverrides<TSchema extends z.ZodType>(
  module: ConfigModule<TSchema>,
  baseValue: z.output<TSchema>,
  env: NodeJS.ProcessEnv,
): z.output<TSchema> {
  return module.schema.parse(mergeConfigRoots(baseValue, module.loadEnv(env)));
}

function parseTomlRoot(configPath: string): RootConfig {
  return RootConfigSchema.parse(asObjectRecord(parseToml(readFileSync(configPath, "utf8"))));
}

function applyRootEnvOverrides(rootConfig: RootConfig, env: NodeJS.ProcessEnv): RootConfig {
  return RootConfigSchema.parse(mergeConfigRoots(rootConfig, loadRootConfigFromEnv(env)));
}

function loadValidatedEnvRoot(
  modules: readonly ConfigModule[],
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  const envLoadedRoot = loadFromEnv(modules, env);
  return validateModules(modules, envLoadedRoot);
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
  appId: typeof AppIds.DATA_PLANE_GATEWAY,
  root: Record<string, unknown>,
): AppConfigModuleValue<typeof AppIds.DATA_PLANE_GATEWAY>;
function parseAppConfig(
  appId: typeof AppIds.DATA_PLANE_WORKER,
  root: Record<string, unknown>,
): AppConfigModuleValue<typeof AppIds.DATA_PLANE_WORKER>;
function parseAppConfig(
  appId: typeof AppIds.TOKENIZER_PROXY,
  root: Record<string, unknown>,
): AppConfigModuleValue<typeof AppIds.TOKENIZER_PROXY>;
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

  if (appId === AppIds.DATA_PLANE_GATEWAY) {
    return parseModuleValue(dataPlaneGatewayConfigModule, root);
  }

  if (appId === AppIds.DATA_PLANE_WORKER) {
    return parseModuleValue(dataPlaneWorkerConfigModule, root);
  }

  if (appId === AppIds.TOKENIZER_PROXY) {
    return parseModuleValue(tokenizerProxyConfigModule, root);
  }

  throw new Error("Unsupported app id.");
}

function composeTokenizerProxyConfig(
  appConfig: unknown,
  globalConfig: AppConfig["global"],
): AppConfigModuleValue<typeof AppIds.TOKENIZER_PROXY> {
  const partialAppConfig = PartialTokenizerProxyConfigSchema.parse(appConfig);

  return tokenizerProxyConfigModule.schema.parse({
    ...partialAppConfig,
    internalAuth: {
      serviceToken: globalConfig.internalAuth.serviceToken,
    },
    egressGrant: globalConfig.sandbox.egress,
  });
}

function composeDataPlaneGatewayConfig(
  appConfig: unknown,
  globalConfig: AppConfig["global"],
): AppConfigModuleValue<typeof AppIds.DATA_PLANE_GATEWAY> {
  const partialAppConfig = PartialDataPlaneGatewayConfigSchema.parse(appConfig);

  return dataPlaneGatewayConfigModule.schema.parse({
    ...partialAppConfig,
    internalAuth: globalConfig.internalAuth,
    sandbox: globalConfig.sandbox,
    telemetry: globalConfig.telemetry,
  });
}

function composeDataPlaneApiConfig(
  appConfig: unknown,
  globalConfig: AppConfig["global"],
): AppConfigModuleValue<typeof AppIds.DATA_PLANE_API> {
  const partialAppConfig = PartialDataPlaneApiConfigSchema.parse(appConfig);

  return dataPlaneApiConfigModule.schema.parse({
    ...partialAppConfig,
    internalAuth: {
      serviceToken: globalConfig.internalAuth.serviceToken,
    },
    sandbox: {
      ...partialAppConfig.sandbox,
      provider: globalConfig.sandbox.provider,
      storage: globalConfig.sandbox.storage,
    },
  });
}

function loadDataPlaneApiConfigFromEnv(env: NodeJS.ProcessEnv): {
  app: AppConfigModuleValue<typeof AppIds.DATA_PLANE_API>;
  global: AppConfig["global"];
} {
  const envLoadedRoot = loadFromEnv([globalConfigModule, dataPlaneApiConfigModule], env);
  const globalRoot = validateModules([globalConfigModule], envLoadedRoot);
  const globalConfig = parseModuleValue(globalConfigModule, globalRoot);
  const appConfig = composeDataPlaneApiConfig(
    getValueAtPath(envLoadedRoot, dataPlaneApiConfigModule.namespace),
    globalConfig,
  );
  const issue = getDataPlaneApiSandboxProviderValidationIssue({
    appSandbox: appConfig.sandbox,
  });

  if (issue !== null) {
    throw new Error(issue.message);
  }

  return {
    global: globalConfig,
    app: appConfig,
  };
}

function loadDataPlaneGatewayConfigFromEnv(env: NodeJS.ProcessEnv): {
  app: AppConfigModuleValue<typeof AppIds.DATA_PLANE_GATEWAY>;
  global: AppConfig["global"];
} {
  const envLoadedRoot = loadFromEnv([globalConfigModule, dataPlaneGatewayConfigModule], env);
  const globalRoot = validateModules([globalConfigModule], envLoadedRoot);
  const globalConfig = parseModuleValue(globalConfigModule, globalRoot);
  const appConfig = composeDataPlaneGatewayConfig(
    getValueAtPath(envLoadedRoot, dataPlaneGatewayConfigModule.namespace),
    globalConfig,
  );

  return {
    global: globalConfig,
    app: appConfig,
  };
}

function loadTokenizerProxyConfigFromEnv(env: NodeJS.ProcessEnv): {
  app: AppConfigModuleValue<typeof AppIds.TOKENIZER_PROXY>;
  global: AppConfig["global"];
} {
  const envLoadedRoot = loadFromEnv([globalConfigModule, tokenizerProxyConfigModule], env);
  const globalRoot = validateModules([globalConfigModule], envLoadedRoot);
  const globalConfig = parseModuleValue(globalConfigModule, globalRoot);
  const appConfig = composeTokenizerProxyConfig(
    getValueAtPath(envLoadedRoot, tokenizerProxyConfigModule.namespace),
    globalConfig,
  );

  return {
    global: globalConfig,
    app: appConfig,
  };
}

function loadSelectedAppConfig(
  appId: typeof AppIds.CONTROL_PLANE_API,
  rootConfig: RootConfig,
  env: NodeJS.ProcessEnv,
): AppConfigModuleValue<typeof AppIds.CONTROL_PLANE_API>;
function loadSelectedAppConfig(
  appId: typeof AppIds.CONTROL_PLANE_WORKER,
  rootConfig: RootConfig,
  env: NodeJS.ProcessEnv,
): AppConfigModuleValue<typeof AppIds.CONTROL_PLANE_WORKER>;
function loadSelectedAppConfig(
  appId: typeof AppIds.DATA_PLANE_API,
  rootConfig: RootConfig,
  env: NodeJS.ProcessEnv,
): AppConfigModuleValue<typeof AppIds.DATA_PLANE_API>;
function loadSelectedAppConfig(
  appId: typeof AppIds.DATA_PLANE_GATEWAY,
  rootConfig: RootConfig,
  env: NodeJS.ProcessEnv,
): AppConfigModuleValue<typeof AppIds.DATA_PLANE_GATEWAY>;
function loadSelectedAppConfig(
  appId: typeof AppIds.DATA_PLANE_WORKER,
  rootConfig: RootConfig,
  env: NodeJS.ProcessEnv,
): AppConfigModuleValue<typeof AppIds.DATA_PLANE_WORKER>;
function loadSelectedAppConfig(
  appId: typeof AppIds.TOKENIZER_PROXY,
  rootConfig: RootConfig,
  env: NodeJS.ProcessEnv,
): AppConfigModuleValue<typeof AppIds.TOKENIZER_PROXY>;
function loadSelectedAppConfig<TApp extends AppConfigModuleKey>(
  appId: TApp,
  rootConfig: RootConfig,
  env: NodeJS.ProcessEnv,
): AppConfigModuleValue<TApp>;
function loadSelectedAppConfig(
  appId: AppConfigModuleKey,
  rootConfig: RootConfig,
  env: NodeJS.ProcessEnv,
): AppConfigModuleValue<AppConfigModuleKey> {
  if (appId === AppIds.CONTROL_PLANE_API) {
    return applyModuleEnvOverrides(
      controlPlaneApiConfigModule,
      selectControlPlaneApiConfig(rootConfig),
      env,
    );
  }

  if (appId === AppIds.CONTROL_PLANE_WORKER) {
    return applyModuleEnvOverrides(
      controlPlaneWorkerConfigModule,
      selectControlPlaneWorkerConfig(rootConfig),
      env,
    );
  }

  if (appId === AppIds.DATA_PLANE_API) {
    const globalConfig = applyModuleEnvOverrides(
      globalConfigModule,
      selectGlobalConfig(rootConfig),
      env,
    );
    const selectedConfig = composeDataPlaneApiConfig(
      selectDataPlaneApiConfig(rootConfig),
      globalConfig,
    );

    return applyModuleEnvOverrides(dataPlaneApiConfigModule, selectedConfig, env);
  }

  if (appId === AppIds.DATA_PLANE_GATEWAY) {
    return applyModuleEnvOverrides(
      dataPlaneGatewayConfigModule,
      selectDataPlaneGatewayConfig(rootConfig),
      env,
    );
  }

  if (appId === AppIds.DATA_PLANE_WORKER) {
    return applyModuleEnvOverrides(
      dataPlaneWorkerConfigModule,
      selectDataPlaneWorkerConfig(rootConfig),
      env,
    );
  }

  if (appId === AppIds.TOKENIZER_PROXY) {
    return applyModuleEnvOverrides(
      tokenizerProxyConfigModule,
      selectTokenizerProxyConfig(rootConfig),
      env,
    );
  }

  throw new Error("Unsupported app id.");
}

function validateSelectedAppConfig(
  appId: AppConfigModuleKey,
  globalConfig: AppConfig["global"],
  rootConfig: RootConfig,
  env: NodeJS.ProcessEnv,
): void {
  if (appId === AppIds.DATA_PLANE_API) {
    const dataPlaneApiConfig = loadSelectedAppConfig(AppIds.DATA_PLANE_API, rootConfig, env);
    const issue = getDataPlaneApiSandboxProviderValidationIssue({
      appSandbox: dataPlaneApiConfig.sandbox,
    });

    if (issue !== null) {
      throw new Error(issue.message);
    }
  } else if (appId === AppIds.DATA_PLANE_WORKER) {
    const dataPlaneWorkerConfig = loadSelectedAppConfig(AppIds.DATA_PLANE_WORKER, rootConfig, env);
    const issue = getDataPlaneWorkerSandboxProviderValidationIssue({
      globalSandboxProvider: globalConfig.sandbox.provider,
      appSandbox: dataPlaneWorkerConfig.sandbox,
    });

    if (issue !== null) {
      throw new Error(issue.message);
    }

    const persistentIssue = getDataPlaneWorkerPersistentSandboxValidationIssue({
      globalSandboxStorageConfig: globalConfig.sandbox.storage,
      appConfig: dataPlaneWorkerConfig,
    });

    if (persistentIssue !== null) {
      throw new Error(persistentIssue.message);
    }
  }
}

export function loadConfig<TApp extends AppConfigModuleKey>(
  options: LoadConfigOptions<TApp>,
): LoadConfigResult<TApp>;
export function loadConfig(options: LoadConfigOptions<AppConfigModuleKey>): LoadConfigResult {
  const appModule = appConfigModules[options.app];
  const { configPath, env } = resolveLoadInputs(options);

  if (configPath !== undefined) {
    const rootConfig = applyRootEnvOverrides(parseTomlRoot(configPath), env);
    const appConfig = loadSelectedAppConfig(options.app, rootConfig, env);

    if (options.includeGlobal === false) {
      return {
        app: appConfig,
      };
    }

    const globalConfig = applyModuleEnvOverrides(
      globalConfigModule,
      selectGlobalConfig(rootConfig),
      env,
    );

    validateSelectedAppConfig(options.app, globalConfig, rootConfig, env);

    return {
      global: globalConfig,
      app: appConfig,
    };
  }

  if (options.includeGlobal === false) {
    if (options.app === AppIds.DATA_PLANE_API) {
      const { app: appConfig } = loadDataPlaneApiConfigFromEnv(env);

      return {
        app: appConfig,
      };
    }

    if (options.app === AppIds.DATA_PLANE_GATEWAY) {
      const { app: appConfig } = loadDataPlaneGatewayConfigFromEnv(env);

      return {
        app: appConfig,
      };
    }

    if (options.app === AppIds.TOKENIZER_PROXY) {
      const { app: appConfig } = loadTokenizerProxyConfigFromEnv(env);

      return {
        app: appConfig,
      };
    }

    const validatedRoot = loadValidatedEnvRoot([appModule], env);
    const appConfig = parseAppConfig(options.app, validatedRoot);
    return {
      app: appConfig,
    };
  }

  if (options.app === AppIds.DATA_PLANE_API) {
    return loadDataPlaneApiConfigFromEnv(env);
  }

  if (options.app === AppIds.DATA_PLANE_GATEWAY) {
    return loadDataPlaneGatewayConfigFromEnv(env);
  }

  if (options.app === AppIds.TOKENIZER_PROXY) {
    return loadTokenizerProxyConfigFromEnv(env);
  }

  const validatedRoot = loadValidatedEnvRoot([globalConfigModule, appModule], env);
  const globalConfig = parseModuleValue(globalConfigModule, validatedRoot);
  const appConfig = parseAppConfig(options.app, validatedRoot);

  if (options.app === AppIds.DATA_PLANE_WORKER) {
    const issue = getDataPlaneWorkerSandboxProviderValidationIssue({
      globalSandboxProvider: globalConfig.sandbox.provider,
      appSandbox: parseModuleValue(dataPlaneWorkerConfigModule, validatedRoot).sandbox,
    });

    if (issue !== null) {
      throw new Error(issue.message);
    }

    const persistentIssue = getDataPlaneWorkerPersistentSandboxValidationIssue({
      globalSandboxStorageConfig: globalConfig.sandbox.storage,
      appConfig: parseModuleValue(dataPlaneWorkerConfigModule, validatedRoot),
    });

    if (persistentIssue !== null) {
      throw new Error(persistentIssue.message);
    }
  }

  return {
    global: globalConfig,
    app: appConfig,
  };
}
