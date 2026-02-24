import type { AppConfig } from "../../schema.js";

type GlobalConfig = AppConfig["global"];
type ControlPlaneApiConfig = AppConfig["apps"]["control_plane_api"];

type AppConfigFixtureOverrides = {
  global?: Partial<GlobalConfig>;
  controlPlaneApi?: Partial<ControlPlaneApiConfig>;
};

export const configEnvKeys = {
  nodeEnv: "NODE_ENV",
  controlPlaneApiHost: "MISTLE_APPS_CONTROL_PLANE_API_HOST",
  controlPlaneApiPort: "MISTLE_APPS_CONTROL_PLANE_API_PORT",
} as const;

export function createGlobalConfig(overrides: Partial<GlobalConfig> = {}): GlobalConfig {
  return {
    env: "development",
    ...overrides,
  };
}

export function createControlPlaneApiConfig(
  overrides: Partial<ControlPlaneApiConfig> = {},
): ControlPlaneApiConfig {
  return {
    host: "127.0.0.1",
    port: 5000,
    ...overrides,
  };
}

export function createAppConfig(overrides: AppConfigFixtureOverrides = {}): AppConfig {
  return {
    global: createGlobalConfig(overrides.global),
    apps: {
      control_plane_api: createControlPlaneApiConfig(overrides.controlPlaneApi),
    },
  };
}

export function createTomlRoot(overrides: AppConfigFixtureOverrides = {}): Record<string, unknown> {
  const config = createAppConfig(overrides);
  const controlPlaneApi = config.apps.control_plane_api;

  return {
    global: {
      env: config.global.env,
    },
    apps: {
      control_plane_api: {
        host: controlPlaneApi.host,
        port: controlPlaneApi.port,
      },
    },
  };
}

export function createConfigEnv(
  configOverrides: AppConfigFixtureOverrides = {},
  envOverrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const config = createAppConfig(configOverrides);
  const controlPlaneApi = config.apps.control_plane_api;

  return {
    [configEnvKeys.nodeEnv]: config.global.env,
    [configEnvKeys.controlPlaneApiHost]: controlPlaneApi.host,
    [configEnvKeys.controlPlaneApiPort]: String(controlPlaneApi.port),
    ...envOverrides,
  };
}

export function createConfigEnvPatch(overrides: AppConfigFixtureOverrides): NodeJS.ProcessEnv {
  const patch: NodeJS.ProcessEnv = {};

  if (overrides.global?.env !== undefined) {
    patch[configEnvKeys.nodeEnv] = overrides.global.env;
  }

  if (overrides.controlPlaneApi?.host !== undefined) {
    patch[configEnvKeys.controlPlaneApiHost] = overrides.controlPlaneApi.host;
  }

  if (overrides.controlPlaneApi?.port !== undefined) {
    patch[configEnvKeys.controlPlaneApiPort] = String(overrides.controlPlaneApi.port);
  }

  return patch;
}
