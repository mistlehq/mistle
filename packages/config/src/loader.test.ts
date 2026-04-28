import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadConfig, parseConfigRecord } from "./loader.js";
import { AppIds } from "./modules.js";
import { getLocalDevDockerRegistrySandboxBaseImageRef } from "./sandbox-base-images.js";

const ConfigSamplePath = fileURLToPath(
  new URL("../../../config/config.sample.toml", import.meta.url),
);
const LocalDevDockerRegistrySandboxBaseImageRef = getLocalDevDockerRegistrySandboxBaseImageRef();

describe("parseConfigRecord", () => {
  it("rejects legacy apps root config records", () => {
    expect(() =>
      parseConfigRecord({
        global: {
          env: "development",
        },
        apps: {},
      }),
    ).toThrow(/Unrecognized key/u);
  });
});

describe("loadConfig", () => {
  it("fails when configPath and env are both missing", () => {
    expect(() =>
      loadConfig({
        app: AppIds.CONTROL_PLANE_API,
      }),
    ).toThrow(/Missing config source/);
  });

  it("loads a selected service config from central TOML resources", () => {
    const loadedConfig = loadConfig({
      app: AppIds.DATA_PLANE_GATEWAY,
      includeGlobal: false,
      configPath: ConfigSamplePath,
    });

    expect(loadedConfig.app.server).toEqual({
      host: "0.0.0.0",
      port: 8084,
    });
    expect(loadedConfig.app.database.url).toBe(
      "postgresql://mistle:replace-with-password@pgbouncer:6432/mistle",
    );
    expect(loadedConfig.app.runtimeState).toEqual({
      backend: "valkey",
      valkey: {
        url: "redis://valkey:6379",
        keyPrefix: "mistle:runtime-state",
      },
    });
  });

  it("loads data-plane worker env config without constructing an apps root", () => {
    const loadedConfig = loadConfig({
      app: AppIds.DATA_PLANE_WORKER,
      includeGlobal: false,
      env: {
        NODE_ENV: "development",
        MISTLE_GLOBAL_TELEMETRY_ENABLED: "false",
        MISTLE_GLOBAL_TELEMETRY_DEBUG: "false",
        MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN: "test-service-token",
        MISTLE_GLOBAL_SANDBOX_PROVIDER: "docker",
        MISTLE_GLOBAL_SANDBOX_DEFAULT_BASE_IMAGE: LocalDevDockerRegistrySandboxBaseImageRef,
        MISTLE_GLOBAL_SANDBOX_GATEWAY_WS_URL: "ws://127.0.0.1:5202/tunnel/sandbox",
        MISTLE_GLOBAL_SANDBOX_INTERNAL_GATEWAY_WS_URL: "ws://127.0.0.1:5202/tunnel/sandbox",
        MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_SECRET: "test-connection-token-secret",
        MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_ISSUER: "control-plane-api",
        MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_AUDIENCE: "data-plane-gateway",
        MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_SECRET: "test-bootstrap-token-secret",
        MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_ISSUER: "data-plane-worker",
        MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_AUDIENCE: "data-plane-gateway",
        MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_SECRET: "test-egress-token-secret",
        MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_ISSUER: "data-plane-worker",
        MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_AUDIENCE: "tokenizer-proxy",
        MISTLE_GLOBAL_SANDBOX_PUBLISH_BASE_DOMAIN: "mistle.example.test",
        MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET: "test-publish-token-secret",
        MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_ISSUER: "control-plane-api",
        MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_AUDIENCE: "data-plane-gateway",
        MISTLE_GLOBAL_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET: "test-publish-cookie-secret",
        MISTLE_APPS_DATA_PLANE_WORKER_DATABASE_URL:
          "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
        MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_DATABASE_URL:
          "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
        MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_NAMESPACE_ID: "development",
        MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "false",
        MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY: "1",
        MISTLE_APPS_DATA_PLANE_WORKER_RUNTIME_STATE_GATEWAY_BASE_URL: "http://127.0.0.1:5202",
        MISTLE_APPS_DATA_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL: "http://127.0.0.1:5100",
        MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_TOKENIZER_PROXY_EGRESS_BASE_URL:
          "http://127.0.0.1:5004/tokenizer-proxy/egress",
        MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SOCKET_PATH: "/var/run/docker.sock",
      },
    });

    expect(loadedConfig.app).toEqual({
      database: {
        url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
      },
      workflow: {
        databaseUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
        namespaceId: "development",
        runMigrations: false,
        concurrency: 1,
      },
      runtimeState: {
        gatewayBaseUrl: "http://127.0.0.1:5202",
      },
      controlPlaneApi: {
        baseUrl: "http://127.0.0.1:5100",
      },
      sandbox: {
        provider: "docker",
        internalGatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
        bootstrap: {
          tokenSecret: "test-bootstrap-token-secret",
          tokenIssuer: "data-plane-worker",
          tokenAudience: "data-plane-gateway",
        },
        egress: {
          tokenSecret: "test-egress-token-secret",
          tokenIssuer: "data-plane-worker",
          tokenAudience: "tokenizer-proxy",
        },
        tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
        docker: {
          socketPath: "/var/run/docker.sock",
        },
      },
      internalAuth: {
        serviceToken: "test-service-token",
      },
      telemetry: {
        enabled: false,
        debug: false,
      },
    });
  });
});
