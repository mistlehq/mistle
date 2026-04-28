import { readFileSync } from "node:fs";

import { parse as parseToml } from "smol-toml";

import { controlPlaneApiConfigModule } from "./apps/control-plane-api/index.js";
import { ControlPlaneApiMaintenanceConfigSchema } from "./apps/control-plane-api/schema.js";
import type { ControlPlaneApiMaintenanceConfig } from "./apps/control-plane-api/schema.js";
import { controlPlaneWorkerConfigModule } from "./apps/control-plane-worker/index.js";
import { dataPlaneApiConfigModule } from "./apps/data-plane-api/index.js";
import { getDataPlaneApiSandboxProviderValidationIssue } from "./apps/data-plane-api/schema.js";
import { dataPlaneGatewayConfigModule } from "./apps/data-plane-gateway/index.js";
import { dataPlaneWorkerConfigModule } from "./apps/data-plane-worker/index.js";
import {
  getDataPlaneWorkerPersistentSandboxValidationIssue,
  getDataPlaneWorkerSandboxProviderValidationIssue,
} from "./apps/data-plane-worker/schema.js";
import { tokenizerProxyConfigModule } from "./apps/tokenizer-proxy/index.js";
import { mergeConfigRoots } from "./core/merge.js";
import { asObjectRecord } from "./core/record.js";
import { AppIds, type AppConfigModuleKey, type AppConfigModuleValue } from "./modules.js";
import { loadRootConfigFromEnv } from "./root/load-env.js";
import { ConfigSchema as RootConfigSchema, type Config as RootConfig } from "./root/schema.js";
import {
  selectControlPlaneApiConfig,
  selectControlPlaneApiMaintenanceConfig,
  selectControlPlaneWorkerConfig,
  selectDataPlaneApiConfig,
  selectDataPlaneGatewayConfig,
  selectDataPlaneWorkerConfig,
  selectGlobalConfig,
  selectTokenizerProxyConfig,
} from "./root/selectors.js";
import { type AppConfig } from "./schema.js";

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

export type LoadControlPlaneMaintenanceConfigResult = {
  app: ControlPlaneApiMaintenanceConfig;
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

function loadControlPlaneMaintenanceConfigFromEnvOnly(
  env: NodeJS.ProcessEnv,
): ControlPlaneApiMaintenanceConfig {
  const legacyMigrationUrl = env.MISTLE_APPS_CONTROL_PLANE_API_DATABASE_MIGRATION_URL;
  const resourceMigrationUrl = env.MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL;

  if (
    legacyMigrationUrl !== undefined &&
    resourceMigrationUrl !== undefined &&
    legacyMigrationUrl !== resourceMigrationUrl
  ) {
    throw new Error(
      "Conflicting env overrides for postgres.control_plane.direct_url. MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL tried to set a different value than MISTLE_APPS_CONTROL_PLANE_API_DATABASE_MIGRATION_URL.",
    );
  }

  const migrationUrl = resourceMigrationUrl ?? legacyMigrationUrl;
  if (migrationUrl === undefined) {
    throw new Error(
      "Missing control-plane maintenance database config. Set MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL or MISTLE_APPS_CONTROL_PLANE_API_DATABASE_MIGRATION_URL.",
    );
  }

  return ControlPlaneApiMaintenanceConfigSchema.parse({
    database: {
      migrationUrl,
    },
    telemetry: loadControlPlaneMaintenanceTelemetryConfigFromEnvOnly(env),
  });
}

function loadControlPlaneMaintenanceTelemetryConfigFromEnvOnly(
  env: NodeJS.ProcessEnv,
): ControlPlaneApiMaintenanceConfig["telemetry"] {
  const enabled = readBooleanEnvAlias({
    env,
    path: "telemetry.enabled",
    newEnvVar: "MISTLE_TELEMETRY_ENABLED",
    legacyEnvVar: "MISTLE_GLOBAL_TELEMETRY_ENABLED",
  });
  const debug = readBooleanEnvAlias({
    env,
    path: "telemetry.debug",
    newEnvVar: "MISTLE_TELEMETRY_DEBUG",
    legacyEnvVar: "MISTLE_GLOBAL_TELEMETRY_DEBUG",
  });
  const tracesEndpoint = readStringEnvAlias({
    env,
    path: "telemetry.traces.endpoint",
    newEnvVar: "MISTLE_TELEMETRY_TRACES_ENDPOINT",
    legacyEnvVar: "MISTLE_GLOBAL_TELEMETRY_TRACES_ENDPOINT",
  });
  const logsEndpoint = readStringEnvAlias({
    env,
    path: "telemetry.logs.endpoint",
    newEnvVar: "MISTLE_TELEMETRY_LOGS_ENDPOINT",
    legacyEnvVar: "MISTLE_GLOBAL_TELEMETRY_LOGS_ENDPOINT",
  });
  const metricsEndpoint = readStringEnvAlias({
    env,
    path: "telemetry.metrics.endpoint",
    newEnvVar: "MISTLE_TELEMETRY_METRICS_ENDPOINT",
    legacyEnvVar: "MISTLE_GLOBAL_TELEMETRY_METRICS_ENDPOINT",
  });
  const resourceAttributes = readStringEnvAlias({
    env,
    path: "telemetry.resource_attributes",
    newEnvVar: "MISTLE_TELEMETRY_RESOURCE_ATTRIBUTES",
    legacyEnvVar: "MISTLE_GLOBAL_TELEMETRY_RESOURCE_ATTRIBUTES",
  });

  return ControlPlaneApiMaintenanceConfigSchema.shape.telemetry.parse({
    enabled: enabled ?? false,
    debug: debug ?? false,
    ...(enabled === true
      ? {
          traces: {
            endpoint: tracesEndpoint,
          },
          logs: {
            endpoint: logsEndpoint,
          },
          metrics: {
            endpoint: metricsEndpoint,
          },
        }
      : {
          ...(tracesEndpoint === undefined
            ? {}
            : {
                traces: {
                  endpoint: tracesEndpoint,
                },
              }),
          ...(logsEndpoint === undefined
            ? {}
            : {
                logs: {
                  endpoint: logsEndpoint,
                },
              }),
          ...(metricsEndpoint === undefined
            ? {}
            : {
                metrics: {
                  endpoint: metricsEndpoint,
                },
              }),
        }),
    ...(resourceAttributes === undefined
      ? {}
      : {
          resourceAttributes,
        }),
  });
}

function readBooleanEnvAlias(input: {
  env: NodeJS.ProcessEnv;
  path: string;
  newEnvVar: string;
  legacyEnvVar: string;
}): boolean | undefined {
  const rawValue = readStringEnvAlias(input);
  if (rawValue === undefined) {
    return undefined;
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  if (normalizedValue === "1" || normalizedValue === "true") {
    return true;
  }
  if (normalizedValue === "0" || normalizedValue === "false") {
    return false;
  }

  throw new Error(`${input.newEnvVar} must be one of: 1, true or 0, false.`);
}

function readStringEnvAlias(input: {
  env: NodeJS.ProcessEnv;
  path: string;
  newEnvVar: string;
  legacyEnvVar: string;
}): string | undefined {
  const newValue = input.env[input.newEnvVar];
  const legacyValue = input.env[input.legacyEnvVar];

  if (newValue !== undefined && legacyValue !== undefined && newValue !== legacyValue) {
    throw new Error(
      `Conflicting env overrides for ${input.path}. ${input.newEnvVar} tried to set a different value than ${input.legacyEnvVar}.`,
    );
  }

  return newValue ?? legacyValue;
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

function loadRootConfigFromEnvOnly(env: NodeJS.ProcessEnv): RootConfig {
  return RootConfigSchema.parse(loadRootConfigFromEnv(env));
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
  const rootConfig = loadRootConfigFromEnvOnly(env);
  validateSelectedAppConfig(appId, rootConfig);

  return {
    global: selectGlobalConfig(rootConfig),
    app: selectAppConfig(appId, rootConfig),
  };
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

export function loadControlPlaneMaintenanceConfig(
  options: LoadConfigSourceOptions,
): LoadControlPlaneMaintenanceConfigResult {
  const { configPath, env } = resolveLoadInputs(options);

  if (configPath === undefined) {
    return {
      app: loadControlPlaneMaintenanceConfigFromEnvOnly(env),
    };
  }

  const rootConfig = loadRootConfig(configPath, env);

  return {
    app: ControlPlaneApiMaintenanceConfigSchema.parse(
      selectControlPlaneApiMaintenanceConfig(rootConfig),
    ),
  };
}
