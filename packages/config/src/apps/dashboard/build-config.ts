import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "smol-toml";
import { z } from "zod";

import { defaultMissingEnabledToFalse } from "../../core/discriminated-union.js";
import { parseBooleanEnv } from "../../core/load-env.js";

export type DashboardBuildEnvironment = "development" | "production";

type UnknownRecord = Record<string, unknown>;

const DashboardPostHogBuildConfigSchema = z.preprocess(
  defaultMissingEnabledToFalse,
  z.discriminatedUnion("enabled", [
    z
      .object({
        enabled: z.literal(true),
        project_api_key: z.string().trim().min(1),
        host: z.string().trim().min(1),
      })
      .strict(),
    z
      .object({
        enabled: z.literal(false),
        project_api_key: z.string().trim().min(1).optional(),
        host: z.string().trim().min(1).optional(),
      })
      .strict(),
  ]),
);

const DashboardBuildConfigSchema = z.object({
  services: z.object({
    dashboard: z.object({
      control_plane_api_origin: z.string().min(1),
      posthog: DashboardPostHogBuildConfigSchema.optional(),
    }),
  }),
});

export type DashboardPostHogBuildConfig =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      projectApiKey: string;
      host: string;
    };

export type DashboardBuildConfig = {
  controlPlaneApiOrigin: string;
  posthog: DashboardPostHogBuildConfig;
};

const SameOriginControlPlaneApiOrigin = "same-origin";

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTomlFile(path: string): UnknownRecord {
  if (!existsSync(path)) {
    throw new Error(`Missing required dashboard config file: ${path}`);
  }

  const content = readFileSync(path, "utf8");
  const parsed = parse(content);
  if (!isRecord(parsed)) {
    throw new Error(`Expected TOML object in ${path}.`);
  }

  return parsed;
}

function resolveWorkspaceRoot(): string {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  return resolve(scriptDirectory, "../../../../..");
}

function normalizeOrigin(value: string, key: string): string {
  if (value === SameOriginControlPlaneApiOrigin) {
    return value;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid absolute URL origin.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${key} must use http:// or https://.`);
  }

  return parsed.origin;
}

function readNonEmptyEnvValue(environment: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = environment[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  return value;
}

function readBooleanEnvValue(environment: NodeJS.ProcessEnv, key: string): boolean | undefined {
  const value = readNonEmptyEnvValue(environment, key);
  if (value === undefined) {
    return undefined;
  }

  return parseBooleanEnv(value, key);
}

function resolveDashboardPostHogBuildConfig(input: {
  environment: NodeJS.ProcessEnv;
  configuredPostHog: z.infer<typeof DashboardPostHogBuildConfigSchema> | undefined;
}): DashboardPostHogBuildConfig {
  const enabled =
    readBooleanEnvValue(input.environment, "MISTLE_SERVICES_DASHBOARD_POSTHOG_ENABLED") ??
    input.configuredPostHog?.enabled ??
    false;
  const projectApiKey =
    readNonEmptyEnvValue(input.environment, "MISTLE_SERVICES_DASHBOARD_POSTHOG_PROJECT_API_KEY") ??
    input.configuredPostHog?.project_api_key;
  const rawHost =
    readNonEmptyEnvValue(input.environment, "MISTLE_SERVICES_DASHBOARD_POSTHOG_HOST") ??
    input.configuredPostHog?.host;

  if (!enabled) {
    return { enabled: false };
  }

  if (projectApiKey === undefined || projectApiKey.trim().length === 0) {
    throw new Error(
      "MISTLE_SERVICES_DASHBOARD_POSTHOG_PROJECT_API_KEY or services.dashboard.posthog.project_api_key is required when PostHog is enabled.",
    );
  }

  if (rawHost === undefined || rawHost.trim().length === 0) {
    throw new Error(
      "MISTLE_SERVICES_DASHBOARD_POSTHOG_HOST or services.dashboard.posthog.host is required when PostHog is enabled.",
    );
  }

  return {
    enabled: true,
    projectApiKey,
    host: normalizeOrigin(
      rawHost,
      "MISTLE_SERVICES_DASHBOARD_POSTHOG_HOST or services.dashboard.posthog.host",
    ),
  };
}

function resolveConfigPath(
  environment: NodeJS.ProcessEnv,
  dashboardBuildEnvironment: DashboardBuildEnvironment,
): string {
  const explicitConfigPath = environment.MISTLE_CONFIG_PATH;

  if (typeof explicitConfigPath === "string" && explicitConfigPath.trim().length > 0) {
    return explicitConfigPath;
  }

  const workspaceRoot = resolveWorkspaceRoot();
  const developmentConfigPath = resolve(workspaceRoot, "config", "config.development.toml");
  if (existsSync(developmentConfigPath)) {
    return developmentConfigPath;
  }

  const productionConfigPath = resolve(workspaceRoot, "config", "config.production.toml");
  if (existsSync(productionConfigPath)) {
    return productionConfigPath;
  }

  throw new Error(
    `Missing required dashboard config file. Set MISTLE_CONFIG_PATH or add ${developmentConfigPath} (preferred) or ${productionConfigPath}. Requested build environment: ${dashboardBuildEnvironment}.`,
  );
}

function readDashboardControlPlaneApiOriginEnv(environment: NodeJS.ProcessEnv): string | undefined {
  return readNonEmptyEnvValue(environment, "MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN");
}

function resolveParsedConfig(input: {
  environment: NodeJS.ProcessEnv;
  dashboardBuildEnvironment: DashboardBuildEnvironment;
  allowMissingConfig: boolean;
}): z.infer<typeof DashboardBuildConfigSchema> | undefined {
  const explicitConfigPath = input.environment.MISTLE_CONFIG_PATH;
  if (typeof explicitConfigPath === "string" && explicitConfigPath.trim().length > 0) {
    return DashboardBuildConfigSchema.parse(parseTomlFile(explicitConfigPath));
  }

  try {
    const configPath = resolveConfigPath(input.environment, input.dashboardBuildEnvironment);
    return DashboardBuildConfigSchema.parse(parseTomlFile(configPath));
  } catch (error) {
    if (
      input.allowMissingConfig &&
      error instanceof Error &&
      error.message.startsWith("Missing required dashboard config file.")
    ) {
      return undefined;
    }

    throw error;
  }
}

export function loadDashboardBuildConfig(
  environment: NodeJS.ProcessEnv,
  dashboardBuildEnvironment: DashboardBuildEnvironment,
): DashboardBuildConfig {
  const explicitControlPlaneApiOrigin = readDashboardControlPlaneApiOriginEnv(environment);
  const parsedConfig = resolveParsedConfig({
    environment,
    dashboardBuildEnvironment,
    allowMissingConfig: explicitControlPlaneApiOrigin !== undefined,
  });

  const controlPlaneApiOrigin = normalizeOrigin(
    explicitControlPlaneApiOrigin ??
      parsedConfig?.services.dashboard.control_plane_api_origin ??
      "",
    explicitControlPlaneApiOrigin === undefined
      ? "MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN or services.dashboard.control_plane_api_origin"
      : "MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN",
  );

  return {
    controlPlaneApiOrigin,
    posthog: resolveDashboardPostHogBuildConfig({
      environment,
      configuredPostHog: parsedConfig?.services.dashboard.posthog,
    }),
  };
}
