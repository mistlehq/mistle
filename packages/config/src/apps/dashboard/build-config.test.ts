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

function removeWorkspaceConfigFile(relativePath: string): void {
  const configPath = resolve(resolveWorkspaceRootForTest(), relativePath);
  const previousContent = existsSync(configPath) ? readFileSync(configPath, "utf8") : null;

  workspaceConfigRestores.push({
    path: configPath,
    previousContent,
  });

  rmSync(configPath, { force: true });
}

function removeDefaultDashboardConfigFiles(): void {
  removeWorkspaceConfigFile("config/config.development.toml");
  removeWorkspaceConfigFile("config/config.production.toml");
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
  postHogConfigLines?: readonly string[];
}): string {
  const directory = createTempDirectory();
  const configPath = join(directory, "config.toml");
  const dashboardOrigin = input?.dashboardOrigin ?? "http://127.0.0.1:5100";

  writeFileSync(
    configPath,
    [
      "[services.dashboard]",
      `control_plane_api_origin = "${dashboardOrigin}"`,
      ...(input?.postHogConfigLines ?? []),
    ]
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
    removeDefaultDashboardConfigFiles();

    const config = loadDashboardBuildConfigForTest({
      env: {
        MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN: "https://api.example.test",
      },
      configPath: "",
    });

    expect(config.controlPlaneApiOrigin).toBe("https://api.example.test");
    expect(config.posthog).toEqual({ enabled: false });
  });

  it("allows explicit single-image same-origin routing without a config file", () => {
    removeDefaultDashboardConfigFiles();

    const config = loadDashboardBuildConfigForTest({
      env: {
        MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN: "same-origin",
      },
      configPath: "",
    });

    expect(config.controlPlaneApiOrigin).toBe("same-origin");
    expect(config.posthog).toEqual({ enabled: false });
  });

  it("fails when explicit dashboard origin is not an absolute URL origin or same-origin", () => {
    removeDefaultDashboardConfigFiles();

    expect(() =>
      loadDashboardBuildConfigForTest({
        env: {
          MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN: "localhost:5100",
        },
        configPath: "",
      }),
    ).toThrow("MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN must use http:// or https://.");
  });

  it("fails when neither env nor config file provides dashboard build config", () => {
    removeDefaultDashboardConfigFiles();

    expect(() =>
      loadDashboardBuildConfigForTest({
        configPath: "",
      }),
    ).toThrow("Missing required dashboard config file.");
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
    expect(config.posthog).toEqual({ enabled: false });
  });

  it("loads dashboard origin from MISTLE_CONFIG_PATH", () => {
    const config = loadDashboardBuildConfigForTest({
      configPath: createDashboardConfigFile(),
    });

    expect(config.controlPlaneApiOrigin).toBe("http://127.0.0.1:5100");
    expect(config.posthog).toEqual({ enabled: false });
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
    expect(config.posthog).toEqual({ enabled: false });
  });

  it("allows single-image builds to use same-origin control-plane API routing", () => {
    const config = loadDashboardBuildConfigForTest({
      configPath: createDashboardConfigFile(),
      env: {
        MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN: "same-origin",
      },
    });

    expect(config.controlPlaneApiOrigin).toBe("same-origin");
    expect(config.posthog).toEqual({ enabled: false });
  });

  it("preserves file-backed PostHog config when dashboard origin is overridden by env", () => {
    const config = loadDashboardBuildConfigForTest({
      configPath: createDashboardConfigFile({
        postHogConfigLines: [
          "",
          "[services.dashboard.posthog]",
          "enabled = true",
          'project_api_key = "phc_from_file"',
          'host = "https://eu.i.posthog.com"',
        ],
      }),
      env: {
        MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN: "https://api.override.test",
      },
    });

    expect(config.controlPlaneApiOrigin).toBe("https://api.override.test");
    expect(config.posthog).toEqual({
      enabled: true,
      projectApiKey: "phc_from_file",
      host: "https://eu.i.posthog.com",
    });
  });

  it("uses file-backed dashboard origin when the origin env var is blank", () => {
    const config = loadDashboardBuildConfigForTest({
      configPath: createDashboardConfigFile({
        dashboardOrigin: "https://api.from-file.test",
      }),
      env: {
        MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN: "",
      },
    });

    expect(config.controlPlaneApiOrigin).toBe("https://api.from-file.test");
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

  it("loads enabled PostHog config from dashboard config", () => {
    const config = loadDashboardBuildConfigForTest({
      configPath: createDashboardConfigFile({
        postHogConfigLines: [
          "",
          "[services.dashboard.posthog]",
          "enabled = true",
          'project_api_key = "phc_example"',
          'host = "https://us.i.posthog.com"',
        ],
      }),
    });

    expect(config.posthog).toEqual({
      enabled: true,
      projectApiKey: "phc_example",
      host: "https://us.i.posthog.com",
    });
  });

  it("keeps PostHog disabled when only PostHog secrets are present", () => {
    const config = loadDashboardBuildConfigForTest({
      env: {
        MISTLE_SERVICES_DASHBOARD_POSTHOG_PROJECT_API_KEY: "phc_example",
        MISTLE_SERVICES_DASHBOARD_POSTHOG_HOST: "https://us.i.posthog.com",
      },
      configPath: createDashboardConfigFile(),
    });

    expect(config.posthog).toEqual({ enabled: false });
  });

  it("loads enabled PostHog config from explicit env without a config file", () => {
    removeDefaultDashboardConfigFiles();

    const config = loadDashboardBuildConfigForTest({
      env: {
        MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN: "https://api.example.test",
        MISTLE_SERVICES_DASHBOARD_POSTHOG_ENABLED: "true",
        MISTLE_SERVICES_DASHBOARD_POSTHOG_PROJECT_API_KEY: "phc_example",
        MISTLE_SERVICES_DASHBOARD_POSTHOG_HOST: "https://us.i.posthog.com",
      },
      configPath: "",
    });

    expect(config.posthog).toEqual({
      enabled: true,
      projectApiKey: "phc_example",
      host: "https://us.i.posthog.com",
    });
  });

  it("preserves discovered file-backed PostHog config when dashboard origin is overridden by env", () => {
    writeWorkspaceConfigFile({
      relativePath: "config/config.development.toml",
      content: [
        "[services.dashboard]",
        'control_plane_api_origin = "https://api.from-file.test"',
        "",
        "[services.dashboard.posthog]",
        "enabled = true",
        'project_api_key = "phc_file"',
        'host = "https://eu.i.posthog.com"',
      ].join("\n"),
    });

    const config = loadDashboardBuildConfigForTest({
      env: {
        MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN: "https://api.example.test",
      },
      configPath: "",
    });

    expect(config.controlPlaneApiOrigin).toBe("https://api.example.test");
    expect(config.posthog).toEqual({
      enabled: true,
      projectApiKey: "phc_file",
      host: "https://eu.i.posthog.com",
    });
  });

  it("fails on invalid explicit config file even when env-backed dashboard config is complete", () => {
    const directory = createTempDirectory();
    const configPath = join(directory, "config.toml");
    writeFileSync(
      configPath,
      [
        "[services.dashboard]",
        'control_plane_api_origin = "https://api.from-file.test"',
        "",
        "[services.dashboard.posthog]",
        "enabled = true",
        'project_api_key = "phc_file"',
      ].join("\n"),
      "utf8",
    );

    expect(() =>
      loadDashboardBuildConfigForTest({
        configPath,
        env: {
          MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN: "https://api.example.test",
          MISTLE_SERVICES_DASHBOARD_POSTHOG_ENABLED: "true",
          MISTLE_SERVICES_DASHBOARD_POSTHOG_PROJECT_API_KEY: "phc_env",
          MISTLE_SERVICES_DASHBOARD_POSTHOG_HOST: "https://us.i.posthog.com",
        },
      }),
    ).toThrow("Invalid input: expected string, received undefined");
  });

  it("fails when an explicit config path is unavailable even when env-backed dashboard config is complete", () => {
    expect(() =>
      loadDashboardBuildConfigForTest({
        configPath: "/missing/runtime/config.toml",
        env: {
          MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN: "https://api.example.test",
          MISTLE_SERVICES_DASHBOARD_POSTHOG_ENABLED: "true",
          MISTLE_SERVICES_DASHBOARD_POSTHOG_PROJECT_API_KEY: "phc_env",
          MISTLE_SERVICES_DASHBOARD_POSTHOG_HOST: "https://us.i.posthog.com",
        },
      }),
    ).toThrow("Missing required dashboard config file: /missing/runtime/config.toml");
  });

  it("requires PostHog project API key when PostHog is enabled", () => {
    removeDefaultDashboardConfigFiles();

    expect(() =>
      loadDashboardBuildConfigForTest({
        env: {
          MISTLE_SERVICES_DASHBOARD_CONTROL_PLANE_API_ORIGIN: "https://api.example.test",
          MISTLE_SERVICES_DASHBOARD_POSTHOG_ENABLED: "true",
          MISTLE_SERVICES_DASHBOARD_POSTHOG_HOST: "https://us.i.posthog.com",
        },
        configPath: "",
      }),
    ).toThrow(
      "MISTLE_SERVICES_DASHBOARD_POSTHOG_PROJECT_API_KEY or services.dashboard.posthog.project_api_key is required when PostHog is enabled.",
    );
  });

  it("requires PostHog host when PostHog is enabled", () => {
    expect(() =>
      loadDashboardBuildConfigForTest({
        env: {
          MISTLE_SERVICES_DASHBOARD_POSTHOG_ENABLED: "true",
          MISTLE_SERVICES_DASHBOARD_POSTHOG_PROJECT_API_KEY: "phc_example",
        },
        configPath: createDashboardConfigFile(),
      }),
    ).toThrow(
      "MISTLE_SERVICES_DASHBOARD_POSTHOG_HOST or services.dashboard.posthog.host is required when PostHog is enabled.",
    );
  });
});
