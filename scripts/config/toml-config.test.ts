import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../../packages/config/src/loader.ts";
import { AppIds } from "../../packages/config/src/modules.ts";
import {
  buildDevelopmentTomlConfig,
  buildIntegrationTomlConfig,
  stringifyTomlConfig,
} from "./toml-config.ts";

function writeTemporaryConfig(content: string): string {
  const directory = mkdtempSync(join(tmpdir(), "mistle-toml-config-"));
  const configPath = join(directory, "config.toml");
  writeFileSync(configPath, content, "utf8");
  return configPath;
}

function removeTemporaryConfig(configPath: string): void {
  rmSync(dirname(configPath), { recursive: true, force: true });
}

function loadEveryAppFromContent(content: string): void {
  const configPath = writeTemporaryConfig(content);

  try {
    loadConfig({ app: AppIds.CONTROL_PLANE_API, configPath });
    loadConfig({ app: AppIds.CONTROL_PLANE_WORKER, configPath });
    loadConfig({ app: AppIds.DATA_PLANE_API, configPath });
    loadConfig({ app: AppIds.DATA_PLANE_GATEWAY, configPath });
    loadConfig({ app: AppIds.DATA_PLANE_WORKER, configPath });
  } finally {
    removeTemporaryConfig(configPath);
  }
}

describe("toml config generation", () => {
  it("generates loadable development TOML with operator comments", () => {
    const content = stringifyTomlConfig({
      header: "",
      configRoot: buildDevelopmentTomlConfig(),
    });

    expect(content).toContain("[services.control_plane_api]");
    expect(content).toContain("[gateway_relay]");
    expect(content).toContain('backend = "memory"');
    expect(content).toContain(
      "# Use direct_url for migrations and pooled_url for app runtime traffic.",
    );
    loadEveryAppFromContent(content);
  });

  it("generates loadable docker integration TOML", () => {
    const content = stringifyTomlConfig({
      header: "",
      configRoot: buildIntegrationTomlConfig({
        providers: ["docker"],
        environment: {},
      }),
    });

    expect(content).toContain('backend = "docker_volume"');
    expect(content).toContain("workflow_database_pool_max = 1");
    loadEveryAppFromContent(content);
  });

  it("generates loadable e2b integration TOML from required env values", () => {
    const content = stringifyTomlConfig({
      header: "",
      configRoot: buildIntegrationTomlConfig({
        providers: ["e2b"],
        remoteSandboxBaseImage: "ghcr.io/mistlehq/sandbox-base:test",
        environment: {
          MISTLE_SANDBOX_E2B_API_KEY: "e2b-test-key",
          MISTLE_SANDBOX_STORAGE_ARCHIL_API_KEY: "archil-test-key",
          MISTLE_SANDBOX_STORAGE_ARCHIL_REGION: "gcp-us-central1",
          MISTLE_OBJECT_STORE_SANDBOX_STORAGE_BUCKET_NAME: "sandbox-storage",
          MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ENDPOINT: "https://storage.example.test",
          MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ACCESS_KEY_ID: "access-key",
          MISTLE_OBJECT_STORE_SANDBOX_STORAGE_SECRET_ACCESS_KEY: "secret-key",
        },
      }),
    });

    expect(content).toContain("[sandbox.e2b]");
    expect(content).toContain("enabled = true");
    expect(content).toContain('mount_object_store = "sandbox_storage"');
    loadEveryAppFromContent(content);
  });

  it("generates loadable tensorlake integration TOML from required env values", () => {
    const content = stringifyTomlConfig({
      header: "",
      configRoot: buildIntegrationTomlConfig({
        providers: ["tensorlake"],
        remoteSandboxBaseImage: "ghcr.io/mistlehq/sandbox-base:test",
        environment: {
          MISTLE_SANDBOX_TENSORLAKE_API_KEY: "tensorlake-test-key",
          MISTLE_SANDBOX_STORAGE_ARCHIL_API_KEY: "archil-test-key",
          MISTLE_SANDBOX_STORAGE_ARCHIL_REGION: "gcp-us-central1",
          MISTLE_OBJECT_STORE_SANDBOX_STORAGE_BUCKET_NAME: "sandbox-storage",
          MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ENDPOINT: "https://storage.example.test",
          MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ACCESS_KEY_ID: "access-key",
          MISTLE_OBJECT_STORE_SANDBOX_STORAGE_SECRET_ACCESS_KEY: "secret-key",
        },
      }),
    });

    expect(content).toContain("[sandbox.tensorlake]");
    expect(content).not.toContain("[sandbox.e2b]");
    expect(content).toContain("enabled = true");
    expect(content).toContain('mount_object_store = "sandbox_storage"');
    loadEveryAppFromContent(content);
  });
});
