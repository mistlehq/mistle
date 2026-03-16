import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "smol-toml";
import { z } from "zod";

type DashboardBuildEnvironment = "development" | "production";

const DashboardBuildConfigSchema = z.object({
  apps: z.object({
    dashboard: z.object({
      control_plane_api_origin: z.string().min(1),
    }),
  }),
});

const TomlRootSchema = z.record(z.string(), z.unknown());

export type DashboardBuildConfig = {
  controlPlaneApiOrigin: string;
};

function parseTomlFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    throw new Error(`Missing required dashboard config file: ${path}`);
  }

  const content = readFileSync(path, "utf8");
  const parsed = parse(content);
  const parsedRoot = TomlRootSchema.safeParse(parsed);
  if (!parsedRoot.success) {
    throw new Error(`Expected TOML object in ${path}.`);
  }

  return parsedRoot.data;
}

function resolveWorkspaceRoot(): string {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  return resolve(scriptDirectory, "../../..");
}

function normalizeOrigin(value: string, key: string): string {
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

export function loadDashboardBuildConfig(
  environment: NodeJS.ProcessEnv,
  dashboardBuildEnvironment: DashboardBuildEnvironment,
): DashboardBuildConfig {
  const configPath = resolveConfigPath(environment, dashboardBuildEnvironment);
  const parsedRoot = parseTomlFile(configPath);

  const parsedConfig = DashboardBuildConfigSchema.parse(parsedRoot);
  const controlPlaneApiOrigin = normalizeOrigin(
    parsedConfig.apps.dashboard.control_plane_api_origin,
    "apps.dashboard.control_plane_api_origin",
  );

  return {
    controlPlaneApiOrigin,
  };
}
