import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "smol-toml";
import { z } from "zod";

type DashboardBuildEnvironment = "development" | "production";

type UnknownRecord = Record<string, unknown>;

const DashboardBuildConfigSchema = z.object({
  apps: z.object({
    dashboard: z.object({
      control_plane_api_origin: z.string().min(1),
    }),
  }),
});

export type DashboardBuildConfig = {
  controlPlaneApiOrigin: string;
};

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
  return resolve(workspaceRoot, "config", `config.${dashboardBuildEnvironment}.toml`);
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
