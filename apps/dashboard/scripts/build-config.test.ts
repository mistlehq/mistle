import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { loadDashboardBuildConfig } from "./build-config.js";

const tempDirectories: string[] = [];
const workspaceConfigRestores: Array<{
  path: string;
  previousContent: string | null;
}> = [];

function createTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "dashboard-build-config-"));
  tempDirectories.push(directory);
  return directory;
}

function resolveWorkspaceRootForTest(): string {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  return resolve(scriptDirectory, "../../..");
}

function writeWorkspaceConfigFile(input: { relativePath: string; content: string }): void {
  const configPath = resolve(resolveWorkspaceRootForTest(), input.relativePath);
  const previousContent = existsSync(configPath) ? readFileSync(configPath, "utf8") : null;

  workspaceConfigRestores.push({
    path: configPath,
    previousContent,
  });

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, input.content, "utf8");
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }

  for (const restore of workspaceConfigRestores.splice(0)) {
    if (restore.previousContent === null) {
      rmSync(restore.path, { force: true });
      continue;
    }

    writeFileSync(restore.path, restore.previousContent, "utf8");
  }
});

function createDashboardConfigFile(input?: {
  dashboardOrigin?: string;
  googleTomlBlock?: string;
}): string {
  const directory = createTempDirectory();
  const configPath = join(directory, "config.toml");
  const dashboardOrigin = input?.dashboardOrigin ?? "http://127.0.0.1:5100";
  const googleTomlBlock = input?.googleTomlBlock ?? "";

  writeFileSync(
    configPath,
    [`[apps.dashboard]`, `control_plane_api_origin = "${dashboardOrigin}"`, "", googleTomlBlock]
      .filter((line) => line.length > 0)
      .join("\n"),
    "utf8",
  );

  return configPath;
}

function loadDashboardBuildConfigForTest(input?: {
  env?: NodeJS.ProcessEnv;
  configPath?: string;
  environment?: "development" | "production";
}) {
  return loadDashboardBuildConfig(
    {
      MISTLE_CONFIG_PATH: input?.configPath,
      ...input?.env,
    },
    input?.environment ?? "development",
  );
}

describe("loadDashboardBuildConfig", () => {
  it("falls back to config/config.development.toml when MISTLE_CONFIG_PATH is unset", () => {
    writeWorkspaceConfigFile({
      relativePath: "config/config.development.toml",
      content: '[apps.dashboard]\ncontrol_plane_api_origin = "http://127.0.0.1:5100"\n',
    });
    writeWorkspaceConfigFile({
      relativePath: "config/config.production.toml",
      content: '[apps.dashboard]\ncontrol_plane_api_origin = "http://127.0.0.1:5200"\n',
    });

    const config = loadDashboardBuildConfig({}, "production");

    expect(config.controlPlaneApiOrigin).toBe("http://127.0.0.1:5100");
    expect(config.authMethods).toEqual({
      google: false,
    });
  });

  it("loads dashboard origin from MISTLE_CONFIG_PATH", () => {
    const config = loadDashboardBuildConfigForTest({
      configPath: createDashboardConfigFile(),
    });

    expect(config.controlPlaneApiOrigin).toBe("http://127.0.0.1:5100");
    expect(config.authMethods).toEqual({
      google: false,
    });
  });

  it("derives google auth availability from control-plane auth config", () => {
    const config = loadDashboardBuildConfigForTest({
      configPath: createDashboardConfigFile({
        googleTomlBlock: [
          "[apps.control_plane_api.auth.google]",
          'client_id = "google-client-id"',
          'client_secret = "google-client-secret"',
        ].join("\n"),
      }),
    });

    expect(config.authMethods).toEqual({
      google: true,
    });
  });

  it("derives google auth availability from env-only control-plane auth config", () => {
    const config = loadDashboardBuildConfigForTest({
      configPath: createDashboardConfigFile(),
      env: {
        MISTLE_APPS_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_ID: "google-client-id",
        MISTLE_APPS_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_SECRET: "google-client-secret",
      },
    });

    expect(config.authMethods).toEqual({
      google: true,
    });
  });

  it.each([
    [{ MISTLE_APPS_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_ID: "google-client-id" }],
    [{ MISTLE_APPS_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_SECRET: "google-client-secret" }],
  ])("fails when google env config is partial: %j", (env) => {
    expect(() =>
      loadDashboardBuildConfigForTest({
        configPath: createDashboardConfigFile(),
        env,
      }),
    ).toThrow(
      "Dashboard build config requires both MISTLE_APPS_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_ID and MISTLE_APPS_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_SECRET when either is set.",
    );
  });

  it("fails when apps.dashboard.control_plane_api_origin is missing", () => {
    expect(() =>
      loadDashboardBuildConfigForTest({
        configPath: createDashboardConfigFile({
          dashboardOrigin: "",
        }),
      }),
    ).toThrow("Too small: expected string to have >=1 characters");
  });

  it("fails when apps.dashboard.control_plane_api_origin is not an absolute URL origin", () => {
    expect(() =>
      loadDashboardBuildConfigForTest({
        configPath: createDashboardConfigFile({
          dashboardOrigin: "localhost:5100",
        }),
        environment: "production",
      }),
    ).toThrow("apps.dashboard.control_plane_api_origin must use http:// or https://.");
  });
});
