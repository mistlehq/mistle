import { readFileSync } from "node:fs";

import { parse as parseToml } from "smol-toml";

import { controlPlaneApiConfigModule } from "./apps/control-plane-api/index.js";
import { PartialControlPlaneApiConfigSchema } from "./apps/control-plane-api/schema.js";
import { controlPlaneWorkerConfigModule } from "./apps/control-plane-worker/index.js";
import { PartialControlPlaneWorkerConfigSchema } from "./apps/control-plane-worker/schema.js";
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
  PartialDataPlaneWorkerConfigSchema,
} from "./apps/data-plane-worker/schema.js";
import { tokenizerProxyConfigModule } from "./apps/tokenizer-proxy/index.js";
import { PartialTokenizerProxyConfigSchema } from "./apps/tokenizer-proxy/schema.js";
import { mergeConfigRoots } from "./core/merge.js";
import { asObjectRecord } from "./core/record.js";
import { globalConfigModule } from "./global/index.js";
import { AppIds, type AppConfigModuleKey, type AppConfigModuleValue } from "./modules.js";
import { type AppConfig } from "./schema.js";
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

function parseTomlRoot(configPath: string): RootConfig {
  return RootConfigSchema.parse(asObjectRecord(parseToml(readFileSync(configPath, "utf8"))));
}

function applyRootEnvOverrides(rootConfig: RootConfig, env: NodeJS.ProcessEnv): RootConfig {
  return RootConfigSchema.parse(mergeConfigRoots(rootConfig, loadRootConfigFromEnv(env)));
}

export function parseConfigRecord(record: unknown): RootConfig {
  return RootConfigSchema.parse(record);
}

function loadGlobalConfigFromEnv(env: NodeJS.ProcessEnv): AppConfig["global"] {
  return globalConfigModule.schema.parse(globalConfigModule.loadEnv(env));
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

function composeControlPlaneApiConfig(
  appConfig: unknown,
  globalConfig: AppConfig["global"],
): AppConfigModuleValue<typeof AppIds.CONTROL_PLANE_API> {
  const partialAppConfig = PartialControlPlaneApiConfigSchema.parse(appConfig);

  return controlPlaneApiConfigModule.schema.parse({
    ...partialAppConfig,
    internalAuth: {
      serviceToken: globalConfig.internalAuth.serviceToken,
    },
    connectionToken: {
      secret: globalConfig.sandbox.connect.tokenSecret,
      issuer: globalConfig.sandbox.connect.tokenIssuer,
      audience: globalConfig.sandbox.connect.tokenAudience,
    },
    portAccess: {
      baseDomain: globalConfig.sandbox.publish.baseDomain,
      gatewayWsUrl: globalConfig.sandbox.gatewayWsUrl,
      access: globalConfig.sandbox.publish.access,
    },
    sandbox: {
      defaultBaseImage: globalConfig.sandbox.defaultBaseImage,
      gatewayWsUrl: globalConfig.sandbox.gatewayWsUrl,
      bootstrap: globalConfig.sandbox.bootstrap,
      storageBackend: globalConfig.sandbox.storage?.backend,
    },
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

function composeControlPlaneWorkerConfig(
  appConfig: unknown,
  globalConfig: AppConfig["global"],
): AppConfigModuleValue<typeof AppIds.CONTROL_PLANE_WORKER> {
  const partialAppConfig = PartialControlPlaneWorkerConfigSchema.parse(appConfig);

  return controlPlaneWorkerConfigModule.schema.parse({
    ...partialAppConfig,
    internalAuth: {
      serviceToken: globalConfig.internalAuth.serviceToken,
    },
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

function composeDataPlaneWorkerConfig(
  appConfig: unknown,
  globalConfig: AppConfig["global"],
): AppConfigModuleValue<typeof AppIds.DATA_PLANE_WORKER> {
  const partialAppConfig = PartialDataPlaneWorkerConfigSchema.parse(appConfig);

  return dataPlaneWorkerConfigModule.schema.parse({
    ...partialAppConfig,
    internalAuth: {
      serviceToken: globalConfig.internalAuth.serviceToken,
    },
    telemetry: globalConfig.telemetry,
    sandbox: {
      ...partialAppConfig.sandbox,
      provider: globalConfig.sandbox.provider,
      storage: globalConfig.sandbox.storage,
      internalGatewayWsUrl: globalConfig.sandbox.internalGatewayWsUrl,
      bootstrap: globalConfig.sandbox.bootstrap,
      egress: globalConfig.sandbox.egress,
    },
  });
}

function selectAppConfig(
  appId: typeof AppIds.CONTROL_PLANE_API,
  rootConfig: RootConfig,
): AppConfigModuleValue<typeof AppIds.CONTROL_PLANE_API>;
function selectAppConfig(
  appId: typeof AppIds.CONTROL_PLANE_WORKER,
  rootConfig: RootConfig,
): AppConfigModuleValue<typeof AppIds.CONTROL_PLANE_WORKER>;
function selectAppConfig(
  appId: typeof AppIds.DATA_PLANE_API,
  rootConfig: RootConfig,
): AppConfigModuleValue<typeof AppIds.DATA_PLANE_API>;
function selectAppConfig(
  appId: typeof AppIds.DATA_PLANE_GATEWAY,
  rootConfig: RootConfig,
): AppConfigModuleValue<typeof AppIds.DATA_PLANE_GATEWAY>;
function selectAppConfig(
  appId: typeof AppIds.DATA_PLANE_WORKER,
  rootConfig: RootConfig,
): AppConfigModuleValue<typeof AppIds.DATA_PLANE_WORKER>;
function selectAppConfig(
  appId: typeof AppIds.TOKENIZER_PROXY,
  rootConfig: RootConfig,
): AppConfigModuleValue<typeof AppIds.TOKENIZER_PROXY>;
function selectAppConfig<TApp extends AppConfigModuleKey>(
  appId: TApp,
  rootConfig: RootConfig,
): AppConfigModuleValue<TApp>;
function selectAppConfig(
  appId: AppConfigModuleKey,
  rootConfig: RootConfig,
): AppConfigModuleValue<AppConfigModuleKey> {
  if (appId === AppIds.CONTROL_PLANE_API) {
    return controlPlaneApiConfigModule.schema.parse(selectControlPlaneApiConfig(rootConfig));
  }

  if (appId === AppIds.CONTROL_PLANE_WORKER) {
    return controlPlaneWorkerConfigModule.schema.parse(selectControlPlaneWorkerConfig(rootConfig));
  }

  if (appId === AppIds.DATA_PLANE_API) {
    return dataPlaneApiConfigModule.schema.parse(selectDataPlaneApiConfig(rootConfig));
  }

  if (appId === AppIds.DATA_PLANE_GATEWAY) {
    return dataPlaneGatewayConfigModule.schema.parse(selectDataPlaneGatewayConfig(rootConfig));
  }

  if (appId === AppIds.DATA_PLANE_WORKER) {
    return dataPlaneWorkerConfigModule.schema.parse(selectDataPlaneWorkerConfig(rootConfig));
  }

  if (appId === AppIds.TOKENIZER_PROXY) {
    return tokenizerProxyConfigModule.schema.parse(selectTokenizerProxyConfig(rootConfig));
  }

  throw new Error("Unsupported app id.");
}

function validateSelectedAppConfig(appId: AppConfigModuleKey, rootConfig: RootConfig): void {
  if (appId === AppIds.DATA_PLANE_API) {
    validateDataPlaneApiConfig(selectAppConfig(AppIds.DATA_PLANE_API, rootConfig));
  } else if (appId === AppIds.DATA_PLANE_WORKER) {
    validateDataPlaneWorkerConfig(selectAppConfig(AppIds.DATA_PLANE_WORKER, rootConfig));
  }
}

function validateDataPlaneApiConfig(
  config: AppConfigModuleValue<typeof AppIds.DATA_PLANE_API>,
): void {
  const issue = getDataPlaneApiSandboxProviderValidationIssue({
    appSandbox: config.sandbox,
  });

  if (issue !== null) {
    throw new Error(issue.message);
  }
}

function validateDataPlaneWorkerConfig(
  config: AppConfigModuleValue<typeof AppIds.DATA_PLANE_WORKER>,
): void {
  const issue = getDataPlaneWorkerSandboxProviderValidationIssue({
    appSandbox: config.sandbox,
  });

  if (issue !== null) {
    throw new Error(issue.message);
  }

  const persistentIssue = getDataPlaneWorkerPersistentSandboxValidationIssue({
    appConfig: config,
  });

  if (persistentIssue !== null) {
    throw new Error(persistentIssue.message);
  }
}

function loadRootConfig(configPath: string, env: NodeJS.ProcessEnv): RootConfig {
  return applyRootEnvOverrides(parseTomlRoot(configPath), env);
}

function loadEnvOnlyConfig(
  appId: typeof AppIds.CONTROL_PLANE_API,
  env: NodeJS.ProcessEnv,
): LoadConfigResult<typeof AppIds.CONTROL_PLANE_API>;
function loadEnvOnlyConfig(
  appId: typeof AppIds.CONTROL_PLANE_WORKER,
  env: NodeJS.ProcessEnv,
): LoadConfigResult<typeof AppIds.CONTROL_PLANE_WORKER>;
function loadEnvOnlyConfig(
  appId: typeof AppIds.DATA_PLANE_API,
  env: NodeJS.ProcessEnv,
): LoadConfigResult<typeof AppIds.DATA_PLANE_API>;
function loadEnvOnlyConfig(
  appId: typeof AppIds.DATA_PLANE_GATEWAY,
  env: NodeJS.ProcessEnv,
): LoadConfigResult<typeof AppIds.DATA_PLANE_GATEWAY>;
function loadEnvOnlyConfig(
  appId: typeof AppIds.DATA_PLANE_WORKER,
  env: NodeJS.ProcessEnv,
): LoadConfigResult<typeof AppIds.DATA_PLANE_WORKER>;
function loadEnvOnlyConfig(
  appId: typeof AppIds.TOKENIZER_PROXY,
  env: NodeJS.ProcessEnv,
): LoadConfigResult<typeof AppIds.TOKENIZER_PROXY>;
function loadEnvOnlyConfig<TApp extends AppConfigModuleKey>(
  appId: TApp,
  env: NodeJS.ProcessEnv,
): LoadConfigResult<TApp>;
function loadEnvOnlyConfig(
  appId: AppConfigModuleKey,
  env: NodeJS.ProcessEnv,
): LoadConfigResult<AppConfigModuleKey> {
  const globalConfig = loadGlobalConfigFromEnv(env);

  if (appId === AppIds.CONTROL_PLANE_API) {
    return {
      global: globalConfig,
      app: composeControlPlaneApiConfig(controlPlaneApiConfigModule.loadEnv(env), globalConfig),
    };
  }

  if (appId === AppIds.CONTROL_PLANE_WORKER) {
    return {
      global: globalConfig,
      app: composeControlPlaneWorkerConfig(
        controlPlaneWorkerConfigModule.loadEnv(env),
        globalConfig,
      ),
    };
  }

  if (appId === AppIds.DATA_PLANE_API) {
    const appConfig = composeDataPlaneApiConfig(
      dataPlaneApiConfigModule.loadEnv(env),
      globalConfig,
    );
    validateDataPlaneApiConfig(appConfig);

    return {
      global: globalConfig,
      app: appConfig,
    };
  }

  if (appId === AppIds.DATA_PLANE_GATEWAY) {
    return {
      global: globalConfig,
      app: composeDataPlaneGatewayConfig(dataPlaneGatewayConfigModule.loadEnv(env), globalConfig),
    };
  }

  if (appId === AppIds.DATA_PLANE_WORKER) {
    const appConfig = composeDataPlaneWorkerConfig(
      dataPlaneWorkerConfigModule.loadEnv(env),
      globalConfig,
    );
    validateDataPlaneWorkerConfig(appConfig);

    return {
      global: globalConfig,
      app: appConfig,
    };
  }

  if (appId === AppIds.TOKENIZER_PROXY) {
    return {
      global: globalConfig,
      app: composeTokenizerProxyConfig(tokenizerProxyConfigModule.loadEnv(env), globalConfig),
    };
  }

  throw new Error("Unsupported app id.");
}

export function loadConfig<TApp extends AppConfigModuleKey>(
  options: LoadConfigOptions<TApp>,
): LoadConfigResult<TApp>;
export function loadConfig(options: LoadConfigOptions<AppConfigModuleKey>): LoadConfigResult {
  const { configPath, env } = resolveLoadInputs(options);

  if (configPath === undefined) {
    const envOnlyConfig = loadEnvOnlyConfig(options.app, env);

    if (options.includeGlobal === false) {
      return {
        app: envOnlyConfig.app,
      };
    }

    return envOnlyConfig;
  }

  const rootConfig = loadRootConfig(configPath, env);
  const appConfig = selectAppConfig(options.app, rootConfig);

  if (options.includeGlobal === false) {
    validateSelectedAppConfig(options.app, rootConfig);

    return {
      app: appConfig,
    };
  }

  validateSelectedAppConfig(options.app, rootConfig);

  return {
    global: selectGlobalConfig(rootConfig),
    app: appConfig,
  };
}
