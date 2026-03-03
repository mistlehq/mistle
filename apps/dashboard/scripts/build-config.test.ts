import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadDashboardBuildConfig } from "./build-config.js";

const tempDirectories: string[] = [];

function createTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "dashboard-build-config-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadDashboardBuildConfig", () => {
  it("falls back to config/config.development.toml when MISTLE_CONFIG_PATH is unset", () => {
    const config = loadDashboardBuildConfig({}, "production");

    expect(config.controlPlaneApiOrigin).toMatch(/^https?:\/\/.+/);
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
