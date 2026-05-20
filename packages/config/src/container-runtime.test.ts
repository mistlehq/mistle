import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { generateContainerRuntimeConfig } from "./container-runtime.js";
import { getValueAtPath } from "./core/record.js";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "mistle-container-runtime-"));
}

function cleanupTempDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

function buildCommonEnv(): NodeJS.ProcessEnv {
  return {
    MISTLE_SERVICES_DASHBOARD_PUBLIC_URL: "https://dashboard.example.test",
    MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL: "https://api.example.test",
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL:
      "wss://gateway.example.test/tunnel/sandbox",
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL:
      "wss://gateway.example.test/tunnel/sandbox",
    MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL: "postgresql://user:pass@postgres:5432/control",
    MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL: "postgresql://user:pass@pgbouncer:6432/control",
    MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL: "postgresql://user:pass@postgres:5432/data",
    MISTLE_POSTGRES_DATA_PLANE_POOLED_URL: "postgresql://user:pass@pgbouncer:6432/data",
    MISTLE_KV_DATA_PLANE_URL: "redis://valkey:6379",
    MISTLE_OBJECT_STORE_ASSETS_BUCKET_NAME: "assets",
    MISTLE_OBJECT_STORE_ASSETS_REGION: "us-east-1",
    MISTLE_OBJECT_STORE_ASSETS_ENDPOINT: "https://s3.example.test",
    MISTLE_OBJECT_STORE_ASSETS_ACCESS_KEY_ID: "assets-access-key",
    MISTLE_OBJECT_STORE_ASSETS_SECRET_ACCESS_KEY: "assets-secret-key",
    MISTLE_EMAIL_SMTP_FROM_ADDRESS: "no-reply@example.test",
    MISTLE_EMAIL_SMTP_HOST: "smtp.example.test",
    MISTLE_EMAIL_SMTP_USERNAME: "smtp-user",
    MISTLE_EMAIL_SMTP_PASSWORD: "smtp-password",
    MISTLE_SANDBOX_DEFAULT_BASE_IMAGE: "ghcr.io/mistle/sandbox:latest",
    MISTLE_SANDBOX_PUBLISH_BASE_DOMAIN: "apps.example.test",
  };
}

function buildDockerSandboxEnv(): NodeJS.ProcessEnv {
  return {
    ...buildCommonEnv(),
    MISTLE_SANDBOX_STORAGE_BACKEND: "docker_volume",
    MISTLE_SANDBOX_DOCKER_ENABLED: "true",
    MISTLE_SANDBOX_DOCKER_SOCKET_PATH: "/var/run/docker.sock",
    MISTLE_SANDBOX_DOCKER_NETWORK_NAME: "mistle-single-container-network",
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL:
      "ws://mistle-single-container:5202/tunnel/sandbox",
    MISTLE_SANDBOX_STORAGE_DOCKER_VOLUME_NAME_PREFIX: "mistle-",
  };
}

function buildRemoteSandboxEnv(): NodeJS.ProcessEnv {
  return {
    ...buildCommonEnv(),
    MISTLE_SANDBOX_STORAGE_BACKEND: "archil",
    MISTLE_SANDBOX_E2B_ENABLED: "true",
    MISTLE_SANDBOX_E2B_API_KEY: "e2b-key",
    MISTLE_SANDBOX_STORAGE_ARCHIL_API_KEY: "archil-key",
    MISTLE_SANDBOX_STORAGE_ARCHIL_REGION: "gcp-us-central1",
    MISTLE_SANDBOX_STORAGE_ARCHIL_MOUNT_OBJECT_STORE: "sandbox_storage",
    MISTLE_OBJECT_STORE_SANDBOX_STORAGE_BUCKET_NAME: "sandbox-storage",
    MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ENDPOINT: "https://sandbox-storage.example.test",
    MISTLE_OBJECT_STORE_SANDBOX_STORAGE_ACCESS_KEY_ID: "sandbox-access-key",
    MISTLE_OBJECT_STORE_SANDBOX_STORAGE_SECRET_ACCESS_KEY: "sandbox-secret-key",
  };
}

describe("generateContainerRuntimeConfig", () => {
  it("generates a single-container config with Docker runtime settings", () => {
    const tempDir = createTempDir();

    try {
      const config = generateContainerRuntimeConfig({
        env: buildDockerSandboxEnv(),
        secretsPath: join(tempDir, "secrets.env"),
      });

      expect(getValueAtPath(config, ["sandbox", "docker", "enabled"])).toBe(true);
      expect(getValueAtPath(config, ["sandbox", "storage", "backend"])).toBe("docker_volume");
      expect(getValueAtPath(config, ["sandbox", "docker", "socket_path"])).toBe(
        "/var/run/docker.sock",
      );
      expect(getValueAtPath(config, ["services", "data_plane_gateway", "internal_url"])).toBe(
        "http://127.0.0.1:5202",
      );
      expect(
        getValueAtPath(config, ["services", "data_plane_gateway", "sandbox_ws_internal_url"]),
      ).toBe("ws://mistle-single-container:5202/tunnel/sandbox");
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  it("generates a single-container config with E2B runtime settings", () => {
    const tempDir = createTempDir();

    try {
      const config = generateContainerRuntimeConfig({
        env: buildRemoteSandboxEnv(),
        secretsPath: join(tempDir, "secrets.env"),
      });

      expect(getValueAtPath(config, ["sandbox", "e2b", "enabled"])).toBe(true);
      expect(getValueAtPath(config, ["sandbox", "storage", "backend"])).toBe("archil");
      expect(getValueAtPath(config, ["sandbox", "storage", "archil", "mount_object_store"])).toBe(
        "sandbox_storage",
      );
      expect(
        getValueAtPath(config, ["services", "data_plane_gateway", "sandbox_ws_internal_url"]),
      ).toBe("wss://gateway.example.test/tunnel/sandbox");
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  it("reuses generated secrets from the persisted secrets file", () => {
    const tempDir = createTempDir();

    try {
      const secretsPath = join(tempDir, "secrets.env");
      const firstConfig = generateContainerRuntimeConfig({
        env: buildDockerSandboxEnv(),
        secretsPath,
      });
      const secondConfig = generateContainerRuntimeConfig({
        env: buildDockerSandboxEnv(),
        secretsPath,
      });

      expect(getValueAtPath(firstConfig, ["internal_auth", "shared_token", "token"])).toEqual(
        getValueAtPath(secondConfig, ["internal_auth", "shared_token", "token"]),
      );
      expect(
        getValueAtPath(firstConfig, ["sandbox", "publish", "session", "cookie_signing_secret"]),
      ).toEqual(
        getValueAtPath(secondConfig, ["sandbox", "publish", "session", "cookie_signing_secret"]),
      );
      expect(getValueAtPath(firstConfig, ["services", "control_plane_api", "mcp", "auth"])).toEqual(
        getValueAtPath(secondConfig, ["services", "control_plane_api", "mcp", "auth"]),
      );
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  it("fails fast when a required user-provided value is missing", () => {
    const tempDir = createTempDir();
    const env = buildDockerSandboxEnv();
    delete env.MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL;

    try {
      expect(() =>
        generateContainerRuntimeConfig({
          env,
          secretsPath: join(tempDir, "secrets.env"),
        }),
      ).toThrow("Missing required environment variable: MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL");
    } finally {
      cleanupTempDir(tempDir);
    }
  });
});
