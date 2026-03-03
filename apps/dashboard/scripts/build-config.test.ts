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
  });

  it("loads dashboard origin from MISTLE_CONFIG_PATH", () => {
    const directory = createTempDirectory();
    const configPath = join(directory, "config.toml");

    writeFileSync(
      configPath,
      '[apps.dashboard]\ncontrol_plane_api_origin = "http://127.0.0.1:5100"\n',
      "utf8",
    );

    const config = loadDashboardBuildConfig(
      {
        MISTLE_CONFIG_PATH: configPath,
      },
      "development",
    );

    expect(config.controlPlaneApiOrigin).toBe("http://127.0.0.1:5100");
  });

  it("fails when apps.dashboard.control_plane_api_origin is missing", () => {
    const directory = createTempDirectory();
    const configPath = join(directory, "config.toml");

    writeFileSync(configPath, "[apps.dashboard]\n", "utf8");

    expect(() =>
      loadDashboardBuildConfig(
        {
          MISTLE_CONFIG_PATH: configPath,
        },
        "development",
      ),
    ).toThrow("Invalid input");
  });

  it("fails when apps.dashboard.control_plane_api_origin is not an absolute URL origin", () => {
    const directory = createTempDirectory();
    const configPath = join(directory, "config.toml");

    writeFileSync(
      configPath,
      '[apps.dashboard]\ncontrol_plane_api_origin = "localhost:5100"\n',
      "utf8",
    );

    expect(() =>
      loadDashboardBuildConfig(
        {
          MISTLE_CONFIG_PATH: configPath,
        },
        "production",
      ),
    ).toThrow("apps.dashboard.control_plane_api_origin must use http:// or https://.");
  });
});
