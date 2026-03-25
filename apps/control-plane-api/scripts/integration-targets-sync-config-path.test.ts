import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadIntegrationTargetsSyncConfig,
  resolveIntegrationTargetsSyncConfigPath,
} from "./integration-targets-sync-config-path.js";

describe("integration-targets-sync-config-path", () => {
  it("prefers MISTLE_CONFIG_PATH when provided", () => {
    const configPath = resolveIntegrationTargetsSyncConfigPath(
      {
        MISTLE_CONFIG_PATH: "/tmp/custom.toml",
      },
      "/workspace/apps/control-plane-api/scripts",
    );

    expect(configPath).toBe("/tmp/custom.toml");
  });

  it("falls back to config/config.development.toml in the workspace root", async () => {
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-sync-config-"));
    const scriptDirectory = join(temporaryWorkspaceRoot, "apps", "control-plane-api", "scripts");
    const developmentConfigPath = join(temporaryWorkspaceRoot, "config", "config.development.toml");

    await mkdir(scriptDirectory, { recursive: true });
    await mkdir(join(temporaryWorkspaceRoot, "config"), { recursive: true });
    await writeFile(developmentConfigPath, "[apps.control_plane_api]\n", "utf8");

    try {
      const configPath = resolveIntegrationTargetsSyncConfigPath({}, scriptDirectory);
      expect(configPath).toBe(developmentConfigPath);
    } finally {
      await rm(temporaryWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("falls back to config/config.production.toml when development config is missing", async () => {
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-sync-config-"));
    const scriptDirectory = join(temporaryWorkspaceRoot, "apps", "control-plane-api", "scripts");
    const productionConfigPath = join(temporaryWorkspaceRoot, "config", "config.production.toml");

    await mkdir(scriptDirectory, { recursive: true });
    await mkdir(join(temporaryWorkspaceRoot, "config"), { recursive: true });
    await writeFile(productionConfigPath, "[apps.control_plane_api]\n", "utf8");

    try {
      const configPath = resolveIntegrationTargetsSyncConfigPath({}, scriptDirectory);
      expect(configPath).toBe(productionConfigPath);
    } finally {
      await rm(temporaryWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("returns undefined when neither env nor workspace config files exist", async () => {
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-sync-config-"));
    const scriptDirectory = join(temporaryWorkspaceRoot, "apps", "control-plane-api", "scripts");
    await mkdir(scriptDirectory, { recursive: true });

    try {
      const configPath = resolveIntegrationTargetsSyncConfigPath({}, scriptDirectory);
      expect(configPath).toBeUndefined();
    } finally {
      await rm(temporaryWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("loads the minimal sync config from development TOML without requiring migrationUrl", async () => {
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-sync-config-"));
    const scriptDirectory = join(temporaryWorkspaceRoot, "apps", "control-plane-api", "scripts");
    const developmentConfigPath = join(temporaryWorkspaceRoot, "config", "config.development.toml");

    await mkdir(scriptDirectory, { recursive: true });
    await mkdir(join(temporaryWorkspaceRoot, "config"), { recursive: true });
    await writeFile(
      developmentConfigPath,
      [
        "[apps.control_plane_api.database]",
        'url = "postgresql://user:pass@localhost:5432/mistle"',
        "",
        "[apps.control_plane_api.integrations]",
        "active_master_encryption_key_version = 1",
        "",
        "[apps.control_plane_api.integrations.master_encryption_keys]",
        '1 = "dev-master-key"',
        "",
      ].join("\n"),
      "utf8",
    );

    try {
      const config = loadIntegrationTargetsSyncConfig({
        environment: {},
        scriptDirectory,
      });

      expect(config).toEqual({
        databaseUrl: "postgresql://user:pass@localhost:5432/mistle",
        integrations: {
          activeMasterEncryptionKeyVersion: 1,
          masterEncryptionKeys: {
            "1": "dev-master-key",
          },
        },
      });
    } finally {
      await rm(temporaryWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("lets environment values override TOML sync config", async () => {
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-sync-config-"));
    const scriptDirectory = join(temporaryWorkspaceRoot, "apps", "control-plane-api", "scripts");
    const developmentConfigPath = join(temporaryWorkspaceRoot, "config", "config.development.toml");

    await mkdir(scriptDirectory, { recursive: true });
    await mkdir(join(temporaryWorkspaceRoot, "config"), { recursive: true });
    await writeFile(
      developmentConfigPath,
      [
        "[apps.control_plane_api.database]",
        'url = "postgresql://user:pass@localhost:5432/mistle"',
        "",
        "[apps.control_plane_api.integrations]",
        "active_master_encryption_key_version = 1",
        "",
        "[apps.control_plane_api.integrations.master_encryption_keys]",
        '1 = "dev-master-key"',
        "",
      ].join("\n"),
      "utf8",
    );

    try {
      const config = loadIntegrationTargetsSyncConfig({
        environment: {
          MISTLE_APPS_CONTROL_PLANE_API_DATABASE_URL:
            "postgresql://override:pass@localhost:6432/mistle",
          MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_ACTIVE_MASTER_ENCRYPTION_KEY_VERSION: "2",
          MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON:
            '{"2":"env-master-key"}',
        },
        scriptDirectory,
      });

      expect(config).toEqual({
        databaseUrl: "postgresql://override:pass@localhost:6432/mistle",
        integrations: {
          activeMasterEncryptionKeyVersion: 2,
          masterEncryptionKeys: {
            "2": "env-master-key",
          },
        },
      });
    } finally {
      await rm(temporaryWorkspaceRoot, { recursive: true, force: true });
    }
  });
});
