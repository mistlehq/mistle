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
  return resolve(scriptDirectory, "../../../../..");
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

function createDashboardConfigFile(input?: { dashboardOrigin?: string }): string {
  const directory = createTempDirectory();
  const configPath = join(directory, "config.toml");
  const dashboardOrigin = input?.dashboardOrigin ?? "http://127.0.0.1:5100";

  writeFileSync(
    configPath,
    ["[services.dashboard]", `control_plane_api_origin = "${dashboardOrigin}"`]
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
  it("loads explicit dashboard origin from MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN without a config file", () => {
    const config = loadDashboardBuildConfigForTest({
      env: {
        MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN: "https://api.example.test",
      },
      configPath: "",
    });

    expect(config.controlPlaneApiOrigin).toBe("https://api.example.test");
  });

  it("allows explicit single-image same-origin routing without a config file", () => {
    const config = loadDashboardBuildConfigForTest({
      env: {
        MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN: "same-origin",
      },
      configPath: "",
    });

    expect(config.controlPlaneApiOrigin).toBe("same-origin");
  });

  it("fails when explicit dashboard origin is not an absolute URL origin or same-origin", () => {
    expect(() =>
      loadDashboardBuildConfigForTest({
        env: {
          MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN: "localhost:5100",
        },
        configPath: "",
      }),
    ).toThrow("MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN must use http:// or https://.");
  });

  it("falls back to config/config.development.toml when MISTLE_CONFIG_PATH is unset", () => {
    writeWorkspaceConfigFile({
      relativePath: "config/config.development.toml",
      content: [
        "[services.dashboard]",
        'control_plane_api_origin = "http://127.0.0.1:5100"',
        "",
        "[services.control_plane_api.auth]",
        'enabled_methods = ["otp"]',
      ].join("\n"),
    });
    writeWorkspaceConfigFile({
      relativePath: "config/config.production.toml",
      content: [
        "[services.dashboard]",
        'control_plane_api_origin = "http://127.0.0.1:5200"',
        "",
        "[services.control_plane_api.auth]",
        'enabled_methods = ["otp"]',
      ].join("\n"),
    });

    const config = loadDashboardBuildConfig({}, "production");

    expect(config.controlPlaneApiOrigin).toBe("http://127.0.0.1:5100");
  });

  it("loads dashboard origin from MISTLE_CONFIG_PATH", () => {
    const config = loadDashboardBuildConfigForTest({
      configPath: createDashboardConfigFile(),
    });

    expect(config.controlPlaneApiOrigin).toBe("http://127.0.0.1:5100");
  });

  it("loads dashboard origin from dashboard-only config shape", () => {
    const directory = createTempDirectory();
    const configPath = join(directory, "config.toml");
    writeFileSync(
      configPath,
      '[services.dashboard]\ncontrol_plane_api_origin = "http://127.0.0.1:5100"\n',
      "utf8",
    );

    const config = loadDashboardBuildConfigForTest({
      configPath,
    });

    expect(config.controlPlaneApiOrigin).toBe("http://127.0.0.1:5100");
  });

  it("allows single-image builds to use same-origin control-plane API routing", () => {
    const config = loadDashboardBuildConfigForTest({
      configPath: createDashboardConfigFile(),
      env: {
        MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN: "same-origin",
      },
    });

    expect(config.controlPlaneApiOrigin).toBe("same-origin");
  });

  it("fails when services.dashboard.control_plane_api_origin is missing", () => {
    expect(() =>
      loadDashboardBuildConfigForTest({
        configPath: createDashboardConfigFile({
          dashboardOrigin: "",
        }),
      }),
    ).toThrow("Too small: expected string to have >=1 characters");
  });

  it("fails when services.dashboard.control_plane_api_origin is not an absolute URL origin or same-origin", () => {
    expect(() =>
      loadDashboardBuildConfigForTest({
        configPath: createDashboardConfigFile({
          dashboardOrigin: "localhost:5100",
        }),
        environment: "production",
      }),
    ).toThrow(
      "MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN or services.dashboard.control_plane_api_origin must use http:// or https://.",
    );
  });
});
