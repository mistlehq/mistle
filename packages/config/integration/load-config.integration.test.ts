import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/loader.js";
import { AppIds } from "../src/modules.js";
import { getLocalDevDockerRegistrySandboxBaseImageRef } from "../src/sandbox-base-images.js";
import { createIntegrationEnv } from "./fixtures/env.js";

const tomlConfigFixturePath = fileURLToPath(new URL("./fixtures/config.toml", import.meta.url));
const configSamplePath = fileURLToPath(
  new URL("../../../config/config.sample.toml", import.meta.url),
);
const serviceToken = "fixture-service-token";
const sandboxConnectTokenSecret = "fixture-connection-token-secret";
const sandboxConnectTokenIssuer = "control-plane-api";
const sandboxConnectTokenAudience = "data-plane-gateway";
const sandboxBootstrapTokenSecret = "fixture-bootstrap-token-secret";
const sandboxBootstrapTokenIssuer = "data-plane-worker";
const sandboxBootstrapTokenAudience = "data-plane-gateway";
const sandboxEgressTokenSecret = "fixture-egress-token-secret";
const sandboxEgressTokenIssuer = "data-plane-worker";
const sandboxEgressTokenAudience = "tokenizer-proxy";
const sandboxPublishBaseDomain = "mistle.example.test";
const sandboxPublishAccessTokenSecret = "fixture-publish-token-secret";
const sandboxPublishAccessTokenIssuer = "control-plane-api";
const sandboxPublishAccessTokenAudience = "data-plane-gateway";
const sandboxPublishSessionCookieSigningSecret = "fixture-publish-cookie-secret";
const LocalDevDockerRegistrySandboxBaseImageRef = getLocalDevDockerRegistrySandboxBaseImageRef();

const globalDevelopmentConfig = {
  env: "development",
  telemetry: {
    enabled: true,
    debug: false,
    traces: {
      endpoint: "http://127.0.0.1:4318/v1/traces",
    },
    logs: {
      endpoint: "http://127.0.0.1:4318/v1/logs",
    },
    metrics: {
      endpoint: "http://127.0.0.1:4318/v1/metrics",
    },
    resourceAttributes: "deployment.environment=test",
  },
  internalAuth: {
    serviceToken,
  },
  sandbox: {
    provider: "docker",
    storage: {
      backend: "archil",
    },
    defaultBaseImage: LocalDevDockerRegistrySandboxBaseImageRef,
    gatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
    internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
    publish: {
      baseDomain: sandboxPublishBaseDomain,
      access: {
        tokenSecret: sandboxPublishAccessTokenSecret,
        tokenIssuer: sandboxPublishAccessTokenIssuer,
        tokenAudience: sandboxPublishAccessTokenAudience,
      },
      session: {
        cookieSigningSecret: sandboxPublishSessionCookieSigningSecret,
      },
    },
    connect: {
      tokenSecret: sandboxConnectTokenSecret,
      tokenIssuer: sandboxConnectTokenIssuer,
      tokenAudience: sandboxConnectTokenAudience,
    },
    bootstrap: {
      tokenSecret: sandboxBootstrapTokenSecret,
      tokenIssuer: sandboxBootstrapTokenIssuer,
      tokenAudience: sandboxBootstrapTokenAudience,
    },
    egress: {
      tokenSecret: sandboxEgressTokenSecret,
      tokenIssuer: sandboxEgressTokenIssuer,
      tokenAudience: sandboxEgressTokenAudience,
    },
  },
} as const;

const globalProductionConfig = {
  env: "production",
  telemetry: {
    enabled: true,
    debug: false,
    traces: {
      endpoint: "http://127.0.0.1:4318/v1/traces",
    },
    logs: {
      endpoint: "http://127.0.0.1:4318/v1/logs",
    },
    metrics: {
      endpoint: "http://127.0.0.1:4318/v1/metrics",
    },
    resourceAttributes: "deployment.environment=test",
  },
  internalAuth: {
    serviceToken,
  },
  sandbox: {
    provider: "docker",
    storage: {
      backend: "archil",
    },
    defaultBaseImage: LocalDevDockerRegistrySandboxBaseImageRef,
    gatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
    internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
    publish: {
      baseDomain: sandboxPublishBaseDomain,
      access: {
        tokenSecret: sandboxPublishAccessTokenSecret,
        tokenIssuer: sandboxPublishAccessTokenIssuer,
        tokenAudience: sandboxPublishAccessTokenAudience,
      },
      session: {
        cookieSigningSecret: sandboxPublishSessionCookieSigningSecret,
      },
    },
    connect: {
      tokenSecret: sandboxConnectTokenSecret,
      tokenIssuer: sandboxConnectTokenIssuer,
      tokenAudience: sandboxConnectTokenAudience,
    },
    bootstrap: {
      tokenSecret: sandboxBootstrapTokenSecret,
      tokenIssuer: sandboxBootstrapTokenIssuer,
      tokenAudience: sandboxBootstrapTokenAudience,
    },
    egress: {
      tokenSecret: sandboxEgressTokenSecret,
      tokenIssuer: sandboxEgressTokenIssuer,
      tokenAudience: sandboxEgressTokenAudience,
    },
  },
} as const;

const globalProductionDockerConfig = {
  ...globalProductionConfig,
  sandbox: {
    ...globalProductionConfig.sandbox,
    provider: "docker",
  },
} as const;

const controlPlaneApiEnvConfig = {
  server: {
    host: "127.0.0.1",
    port: 5000,
  },
  database: {
    url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
    migrationUrl: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
  },
  objectStore: {
    bucketName: "mistle-assets",
    region: "us-east-1",
    endpoint: "http://127.0.0.1:8333",
    forcePathStyle: true,
    accessKeyId: "mistle-access-key",
    secretAccessKey: "mistle-secret-key",
  },
  auth: {
    baseUrl: "http://127.0.0.1:5000",
    secret: "test-secret",
    trustedOrigins: ["http://127.0.0.1:3000"],
    otpLength: 6,
    otpExpiresInSeconds: 300,
    otpAllowedAttempts: 3,
  },
  dashboard: {
    baseUrl: "http://127.0.0.1:5173",
  },
  workflow: {
    databaseUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
    migrationUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
    namespaceId: "development",
  },
  dataPlaneApi: {
    baseUrl: "http://127.0.0.1:5002",
  },
  integrations: {
    activeMasterEncryptionKeyVersion: 1,
    masterEncryptionKeys: {
      "1": "integration-master-key-development",
    },
  },
} as const;

const controlPlaneApiBaseFixtureConfig = {
  ...controlPlaneApiEnvConfig,
  server: {
    host: "0.0.0.0",
    port: 5100,
  },
  workflow: {
    ...controlPlaneApiEnvConfig.workflow,
    namespaceId: "fixture",
  },
  dataPlaneApi: {
    baseUrl: "http://127.0.0.1:5300",
  },
  integrations: {
    activeMasterEncryptionKeyVersion: 2,
    masterEncryptionKeys: {
      "2": "integration-master-key-fixture",
    },
  },
} as const;

const controlPlaneWorkerEnvConfig = {
  workflow: {
    databaseUrl: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
    namespaceId: "development",
    runMigrations: true,
    concurrency: 1,
  },
  email: {
    fromAddress: "no-reply@mistle.local",
    fromName: "Mistle Local",
    smtpHost: "127.0.0.1",
    smtpPort: 1025,
    smtpSecure: false,
    smtpUsername: "mailpit",
    smtpPassword: "mailpit",
  },
  dataPlaneApi: {
    baseUrl: "http://127.0.0.1:5002",
  },
  controlPlaneApi: {
    baseUrl: "http://127.0.0.1:5000",
  },
} as const;

const controlPlaneWorkerBaseFixtureConfig = {
  ...controlPlaneWorkerEnvConfig,
  workflow: {
    ...controlPlaneWorkerEnvConfig.workflow,
    namespaceId: "fixture",
    concurrency: 2,
  },
  dataPlaneApi: {
    baseUrl: "http://127.0.0.1:5300",
  },
  controlPlaneApi: {
    baseUrl: "http://127.0.0.1:5100",
  },
} as const;

const dataPlaneApiEnvConfig = {
  server: {
    host: "127.0.0.1",
    port: 5002,
  },
  database: {
    url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
    migrationUrl: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
  },
  workflow: {
    databaseUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
    migrationUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
    namespaceId: "development",
  },
  runtimeState: {
    gatewayBaseUrl: "http://127.0.0.1:5003",
  },
  controlPlaneApi: {
    baseUrl: "http://127.0.0.1:5000",
  },
  sandbox: {
    docker: {
      socketPath: "/var/run/docker.sock",
    },
  },
} as const;

const dataPlaneApiBaseFixtureConfig = {
  ...dataPlaneApiEnvConfig,
  server: {
    host: "0.0.0.0",
    port: 5300,
  },
  workflow: {
    ...dataPlaneApiEnvConfig.workflow,
    namespaceId: "fixture",
  },
  runtimeState: {
    gatewayBaseUrl: "http://127.0.0.1:5302",
  },
  controlPlaneApi: {
    baseUrl: "http://127.0.0.1:5100",
  },
} as const;

const dataPlaneGatewayEnvConfig = {
  server: {
    host: "127.0.0.1",
    port: 5003,
  },
  database: {
    url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
  },
  runtimeState: {
    backend: "valkey",
    valkey: {
      url: "redis://127.0.0.1:6379",
      keyPrefix: "mistle:runtime-state:integration",
    },
  },
  dataPlaneApi: {
    baseUrl: "http://127.0.0.1:5002",
  },
  controlPlaneApi: {
    baseUrl: "http://127.0.0.1:5000",
  },
} as const;

const dataPlaneGatewayBaseFixtureConfig = {
  ...dataPlaneGatewayEnvConfig,
  server: {
    host: "0.0.0.0",
    port: 5302,
  },
  runtimeState: {
    backend: "valkey",
    valkey: {
      url: "redis://127.0.0.1:6379",
      keyPrefix: "mistle:runtime-state:fixture",
    },
  },
  dataPlaneApi: {
    baseUrl: "http://127.0.0.1:5300",
  },
  controlPlaneApi: {
    baseUrl: "http://127.0.0.1:5100",
  },
} as const;

const dataPlaneWorkerEnvConfig = {
  database: {
    url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
  },
  workflow: {
    databaseUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
    namespaceId: "development",
    runMigrations: true,
    concurrency: 1,
  },
  runtimeState: {
    gatewayBaseUrl: "http://127.0.0.1:5003",
  },
  controlPlaneApi: {
    baseUrl: "http://127.0.0.1:5000",
  },
  sandbox: {
    tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
    docker: {
      socketPath: "/var/run/docker.sock",
      networkName: "mistle-sandbox-dev",
    },
  },
  sandboxStorage: {
    archil: {
      apiKey: "fixture-archil-api-key",
      region: "gcp-us-central1",
      namePrefix: "mistle-",
      mounts: [
        {
          type: "s3-compatible",
          bucket: "mistle-sandbox-storage",
          endpoint: "https://s3.example.com",
          accessKeyId: "fixture-access-key-id",
          secretAccessKey: "fixture-secret-access-key",
        },
      ],
    },
  },
} as const;

const dataPlaneWorkerBaseFixtureConfig = {
  ...dataPlaneWorkerEnvConfig,
  workflow: {
    ...dataPlaneWorkerEnvConfig.workflow,
    namespaceId: "fixture",
    concurrency: 2,
  },
  runtimeState: {
    gatewayBaseUrl: "http://127.0.0.1:5302",
  },
  controlPlaneApi: {
    baseUrl: "http://127.0.0.1:5100",
  },
} as const;

const dataPlaneWorkerDockerFixtureConfig = {
  database: {
    url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
  },
  workflow: {
    databaseUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
    namespaceId: "fixture-docker",
    runMigrations: true,
    concurrency: 3,
  },
  runtimeState: {
    gatewayBaseUrl: "http://127.0.0.1:5003",
  },
  controlPlaneApi: {
    baseUrl: "http://127.0.0.1:5100",
  },
  sandbox: {
    tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
    docker: {
      socketPath: "/var/run/docker.sock",
      networkName: "mistle-sandbox-dev",
    },
  },
  sandboxStorage: {
    archil: {
      apiKey: "fixture-archil-api-key",
      region: "gcp-us-central1",
      namePrefix: "mistle-",
      mounts: [
        {
          type: "s3-compatible",
          bucket: "mistle-sandbox-storage",
          endpoint: "https://s3.example.com",
          accessKeyId: "fixture-access-key-id",
          secretAccessKey: "fixture-secret-access-key",
        },
      ],
    },
  },
} as const;

const tokenizerProxyEnvConfig = {
  server: {
    host: "127.0.0.1",
    port: 5005,
  },
  controlPlaneApi: {
    baseUrl: "http://127.0.0.1:5000",
    publicBaseUrl: "https://public-control-plane.example.test",
  },
  internalAuth: {
    serviceToken,
  },
  egressGrant: {
    tokenSecret: sandboxEgressTokenSecret,
    tokenIssuer: sandboxEgressTokenIssuer,
    tokenAudience: sandboxEgressTokenAudience,
  },
} as const;

const tokenizerProxyBaseFixtureConfig = {
  ...tokenizerProxyEnvConfig,
  server: {
    host: "0.0.0.0",
    port: 5305,
  },
  controlPlaneApi: {
    baseUrl: "http://127.0.0.1:5100",
    publicBaseUrl: "https://mistle.example.test",
  },
} as const;

const pooledPostgresUrl = "postgresql://mistle:mistle@127.0.0.1:6432/mistle";
const directPostgresUrl = "postgresql://mistle:mistle@127.0.0.1:5432/mistle";

const controlPlaneApiFixtureConfig = {
  ...controlPlaneApiBaseFixtureConfig,
  database: {
    url: pooledPostgresUrl,
    migrationUrl: controlPlaneApiBaseFixtureConfig.database.migrationUrl,
  },
  auth: {
    ...controlPlaneApiBaseFixtureConfig.auth,
    baseUrl: "https://mistle.example.test",
  },
  workflow: {
    ...controlPlaneApiBaseFixtureConfig.workflow,
    migrationUrl: directPostgresUrl,
  },
};

const controlPlaneWorkerFixtureConfig = {
  ...controlPlaneWorkerBaseFixtureConfig,
  workflow: {
    ...controlPlaneWorkerBaseFixtureConfig.workflow,
    databaseUrl: pooledPostgresUrl,
    runMigrations: false,
  },
};

const dataPlaneApiFixtureConfig = {
  ...dataPlaneApiBaseFixtureConfig,
  database: {
    url: pooledPostgresUrl,
    migrationUrl: dataPlaneApiBaseFixtureConfig.database.migrationUrl,
  },
  workflow: {
    ...dataPlaneApiBaseFixtureConfig.workflow,
    migrationUrl: directPostgresUrl,
  },
};

const dataPlaneGatewayFixtureConfig = {
  ...dataPlaneGatewayBaseFixtureConfig,
  database: {
    url: pooledPostgresUrl,
  },
};

const dataPlaneWorkerFixtureConfig = {
  ...dataPlaneWorkerBaseFixtureConfig,
  database: {
    url: pooledPostgresUrl,
  },
  workflow: {
    ...dataPlaneWorkerBaseFixtureConfig.workflow,
    runMigrations: false,
  },
};

const tokenizerProxyFixtureConfig = {
  ...tokenizerProxyBaseFixtureConfig,
  controlPlaneApi: {
    baseUrl: tokenizerProxyBaseFixtureConfig.controlPlaneApi.baseUrl,
    publicBaseUrl: "https://mistle.example.test",
  },
};

describe("loadConfig integrations", () => {
  it("loads every app from config.sample.toml", () => {
    expect(() => {
      loadConfig({ app: AppIds.CONTROL_PLANE_API, configPath: configSamplePath });
      loadConfig({ app: AppIds.CONTROL_PLANE_WORKER, configPath: configSamplePath });
      loadConfig({ app: AppIds.DATA_PLANE_API, configPath: configSamplePath });
      loadConfig({ app: AppIds.DATA_PLANE_GATEWAY, configPath: configSamplePath });
      loadConfig({ app: AppIds.DATA_PLANE_WORKER, configPath: configSamplePath });
      loadConfig({ app: AppIds.TOKENIZER_PROXY, configPath: configSamplePath });
    }).not.toThrow();
  });

  it("loads every app from the toml config file fixture", () => {
    expect(
      loadConfig({
        app: AppIds.CONTROL_PLANE_API,
        configPath: tomlConfigFixturePath,
      }),
    ).toEqual({
      global: globalDevelopmentConfig,
      app: controlPlaneApiFixtureConfig,
    });
    expect(
      loadConfig({
        app: AppIds.CONTROL_PLANE_WORKER,
        configPath: tomlConfigFixturePath,
      }),
    ).toEqual({
      global: globalDevelopmentConfig,
      app: controlPlaneWorkerFixtureConfig,
    });
    expect(
      loadConfig({
        app: AppIds.DATA_PLANE_API,
        configPath: tomlConfigFixturePath,
      }),
    ).toEqual({
      global: globalDevelopmentConfig,
      app: dataPlaneApiFixtureConfig,
    });
    expect(
      loadConfig({
        app: AppIds.DATA_PLANE_GATEWAY,
        configPath: tomlConfigFixturePath,
      }),
    ).toEqual({
      global: globalDevelopmentConfig,
      app: dataPlaneGatewayFixtureConfig,
    });
    expect(
      loadConfig({
        app: AppIds.DATA_PLANE_WORKER,
        configPath: tomlConfigFixturePath,
      }),
    ).toEqual({
      global: globalDevelopmentConfig,
      app: dataPlaneWorkerFixtureConfig,
    });
    expect(
      loadConfig({
        app: AppIds.TOKENIZER_PROXY,
        configPath: tomlConfigFixturePath,
      }),
    ).toEqual({
      global: globalDevelopmentConfig,
      app: tokenizerProxyFixtureConfig,
    });
  });

  it("applies env overrides after loading the toml config file fixture", () => {
    const config = loadConfig({
      app: AppIds.CONTROL_PLANE_API,
      configPath: tomlConfigFixturePath,
      env: {
        MISTLE_APPS_CONTROL_PLANE_API_HOST: "localhost",
      },
    });

    expect(config).toEqual({
      global: globalDevelopmentConfig,
      app: {
        ...controlPlaneApiFixtureConfig,
        server: {
          host: "localhost",
          port: 5100,
        },
      },
    });
  });

  it("maps existing service-specific env overrides into central resources before service selection", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_GATEWAY,
      configPath: tomlConfigFixturePath,
      env: {
        MISTLE_APPS_CONTROL_PLANE_API_DATA_PLANE_API_BASE_URL: "https://data-plane.internal.test",
      },
    });

    expect(config.app.dataPlaneApi).toEqual({
      baseUrl: "https://data-plane.internal.test",
    });
  });

  it("rejects conflicting existing env aliases for the same central resource", () => {
    expect(() =>
      loadConfig({
        app: AppIds.DATA_PLANE_GATEWAY,
        configPath: tomlConfigFixturePath,
        env: {
          MISTLE_APPS_CONTROL_PLANE_API_DATA_PLANE_API_BASE_URL: "https://data-plane-a.test",
          MISTLE_APPS_CONTROL_PLANE_WORKER_DATA_PLANE_API_BASE_URL: "https://data-plane-b.test",
        },
      }),
    ).toThrow(/Conflicting env overrides for services\.data_plane_api\.internal_url/);
  });

  it("returns only app config for the toml config file fixture when includeGlobal is false", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_WORKER,
      includeGlobal: false,
      configPath: tomlConfigFixturePath,
    });

    expect(config).toEqual({
      app: dataPlaneWorkerFixtureConfig,
    });
  });

  it("loads control-plane-api purely from a config file fixture", () => {
    const config = loadConfig({
      app: AppIds.CONTROL_PLANE_API,
      configPath: tomlConfigFixturePath,
    });

    expect(config).toEqual({
      global: globalDevelopmentConfig,
      app: controlPlaneApiFixtureConfig,
    });
  });

  it("loads control-plane-api purely from env", () => {
    const config = loadConfig({
      app: AppIds.CONTROL_PLANE_API,
      env: createIntegrationEnv({
        NODE_ENV: "production",
        MISTLE_APPS_CONTROL_PLANE_API_HOST: "localhost",
        MISTLE_APPS_CONTROL_PLANE_API_PORT: "5300",
      }),
    });

    expect(config).toEqual({
      global: globalProductionConfig,
      app: {
        ...controlPlaneApiEnvConfig,
        server: {
          host: "localhost",
          port: 5300,
        },
      },
    });
  });

  it("loads control-plane-api from both config file and env, with env precedence", () => {
    const config = loadConfig({
      app: AppIds.CONTROL_PLANE_API,
      configPath: tomlConfigFixturePath,
      env: {
        MISTLE_APPS_CONTROL_PLANE_API_HOST: "localhost",
      },
    });

    expect(config).toEqual({
      global: globalDevelopmentConfig,
      app: {
        ...controlPlaneApiFixtureConfig,
        server: {
          host: "localhost",
          port: 5100,
        },
      },
    });
  });

  it("returns only control-plane-api app config when includeGlobal is false", () => {
    const config = loadConfig({
      app: AppIds.CONTROL_PLANE_API,
      includeGlobal: false,
      configPath: tomlConfigFixturePath,
    });

    expect(config).toEqual({
      app: controlPlaneApiFixtureConfig,
    });
  });

  it("loads control-plane-worker purely from a config file fixture", () => {
    const config = loadConfig({
      app: AppIds.CONTROL_PLANE_WORKER,
      configPath: tomlConfigFixturePath,
    });

    expect(config).toEqual({
      global: globalDevelopmentConfig,
      app: controlPlaneWorkerFixtureConfig,
    });
  });

  it("loads control-plane-worker purely from env", () => {
    const config = loadConfig({
      app: AppIds.CONTROL_PLANE_WORKER,
      env: createIntegrationEnv({
        NODE_ENV: "production",
      }),
    });

    expect(config).toEqual({
      global: globalProductionConfig,
      app: controlPlaneWorkerEnvConfig,
    });
  });

  it("loads control-plane-worker from both config file and env, with env precedence", () => {
    const config = loadConfig({
      app: AppIds.CONTROL_PLANE_WORKER,
      configPath: tomlConfigFixturePath,
      env: {
        MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_NAMESPACE_ID: "override",
      },
    });

    expect(config).toEqual({
      global: globalDevelopmentConfig,
      app: {
        ...controlPlaneWorkerFixtureConfig,
        workflow: {
          ...controlPlaneWorkerFixtureConfig.workflow,
          namespaceId: "override",
        },
      },
    });
  });

  it("returns only control-plane-worker app config when includeGlobal is false", () => {
    const config = loadConfig({
      app: AppIds.CONTROL_PLANE_WORKER,
      includeGlobal: false,
      configPath: tomlConfigFixturePath,
    });

    expect(config).toEqual({
      app: controlPlaneWorkerFixtureConfig,
    });
  });

  it("loads data-plane-api purely from a config file fixture", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_API,
      configPath: tomlConfigFixturePath,
    });

    expect(config).toEqual({
      global: globalDevelopmentConfig,
      app: dataPlaneApiFixtureConfig,
    });
  });

  it("loads data-plane-api purely from env", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_API,
      env: createIntegrationEnv({
        NODE_ENV: "production",
        MISTLE_APPS_DATA_PLANE_API_HOST: "localhost",
        MISTLE_APPS_DATA_PLANE_API_PORT: "5302",
      }),
    });

    expect(config).toEqual({
      global: globalProductionConfig,
      app: {
        ...dataPlaneApiEnvConfig,
        server: {
          host: "localhost",
          port: 5302,
        },
      },
    });
  });

  it("rejects data-plane-api config when control-plane API config is missing", () => {
    expect(() =>
      loadConfig({
        app: AppIds.DATA_PLANE_API,
        env: createIntegrationEnv({
          MISTLE_APPS_DATA_PLANE_API_CONTROL_PLANE_API_BASE_URL: undefined,
        }),
      }),
    ).toThrow(/controlPlaneApi/i);
  });

  it("loads data-plane-api from both config file and env, with env precedence", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_API,
      configPath: tomlConfigFixturePath,
      env: {
        MISTLE_APPS_DATA_PLANE_API_WORKFLOW_NAMESPACE_ID: "override",
      },
    });

    expect(config).toEqual({
      global: globalDevelopmentConfig,
      app: {
        ...dataPlaneApiFixtureConfig,
        workflow: {
          ...dataPlaneApiFixtureConfig.workflow,
          namespaceId: "override",
        },
      },
    });
  });

  it("returns only data-plane-api app config when includeGlobal is false", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_API,
      includeGlobal: false,
      configPath: tomlConfigFixturePath,
    });

    expect(config).toEqual({
      app: dataPlaneApiFixtureConfig,
    });
  });

  it("loads data-plane-gateway purely from a config file fixture", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_GATEWAY,
      configPath: tomlConfigFixturePath,
    });

    expect(config).toEqual({
      global: globalDevelopmentConfig,
      app: dataPlaneGatewayFixtureConfig,
    });
  });

  it("loads data-plane-gateway purely from env", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_GATEWAY,
      env: createIntegrationEnv({
        NODE_ENV: "production",
        MISTLE_APPS_DATA_PLANE_GATEWAY_HOST: "localhost",
        MISTLE_APPS_DATA_PLANE_GATEWAY_PORT: "5303",
      }),
    });

    expect(config).toEqual({
      global: globalProductionConfig,
      app: {
        ...dataPlaneGatewayEnvConfig,
        server: {
          host: "localhost",
          port: 5303,
        },
      },
    });
  });

  it("loads data-plane-gateway when lifecycle config is omitted from env", () => {
    const env = createIntegrationEnv({
      NODE_ENV: "production",
    });

    const config = loadConfig({
      app: AppIds.DATA_PLANE_GATEWAY,
      env,
    });

    expect(config).toEqual({
      global: globalProductionConfig,
      app: {
        server: dataPlaneGatewayEnvConfig.server,
        database: dataPlaneGatewayEnvConfig.database,
        runtimeState: dataPlaneGatewayEnvConfig.runtimeState,
        dataPlaneApi: dataPlaneGatewayEnvConfig.dataPlaneApi,
        controlPlaneApi: dataPlaneGatewayEnvConfig.controlPlaneApi,
      },
    });
  });

  it("loads data-plane-gateway from both config file and env, with env precedence", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_GATEWAY,
      configPath: tomlConfigFixturePath,
      env: {
        MISTLE_APPS_DATA_PLANE_GATEWAY_HOST: "localhost",
      },
    });

    expect(config).toEqual({
      global: globalDevelopmentConfig,
      app: {
        ...dataPlaneGatewayFixtureConfig,
        server: {
          host: "localhost",
          port: 5302,
        },
      },
    });
  });

  it("returns only data-plane-gateway app config when includeGlobal is false", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_GATEWAY,
      includeGlobal: false,
      configPath: tomlConfigFixturePath,
    });

    expect(config).toEqual({
      app: dataPlaneGatewayFixtureConfig,
    });
  });

  it("loads data-plane-worker purely from a config file fixture", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_WORKER,
      configPath: tomlConfigFixturePath,
    });

    expect(config).toEqual({
      global: globalDevelopmentConfig,
      app: dataPlaneWorkerFixtureConfig,
    });
  });

  it("loads data-plane-worker purely from env", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_WORKER,
      env: createIntegrationEnv({
        NODE_ENV: "production",
      }),
    });

    expect(config).toEqual({
      global: globalProductionConfig,
      app: dataPlaneWorkerEnvConfig,
    });
  });

  it("loads data-plane-worker with docker sandbox config from env", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_WORKER,
      env: createIntegrationEnv({
        NODE_ENV: "production",
        MISTLE_GLOBAL_SANDBOX_PROVIDER: "docker",
        MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SOCKET_PATH: "/var/run/docker.sock",
        MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_NETWORK_NAME: "mistle-sandbox-dev",
        MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_TRACES_ENDPOINT:
          "http://otel-lgtm:4318/v1/traces",
      }),
    });

    expect(config).toEqual({
      global: globalProductionDockerConfig,
      app: {
        ...dataPlaneWorkerEnvConfig,
        sandbox: dataPlaneWorkerDockerFixtureConfig.sandbox,
      },
    });
  });

  it("loads data-plane-worker from both config file and env, with env precedence", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_WORKER,
      configPath: tomlConfigFixturePath,
      env: {
        MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_NAMESPACE_ID: "override",
      },
    });

    expect(config).toEqual({
      global: globalDevelopmentConfig,
      app: {
        ...dataPlaneWorkerFixtureConfig,
        workflow: {
          ...dataPlaneWorkerFixtureConfig.workflow,
          namespaceId: "override",
        },
      },
    });
  });

  it("merges partial docker sandbox overrides across toml config file and env", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_WORKER,
      configPath: tomlConfigFixturePath,
      env: {
        MISTLE_GLOBAL_SANDBOX_PROVIDER: "docker",
        MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SOCKET_PATH: "/tmp/docker.sock",
      },
    });

    expect(config).toEqual({
      global: globalDevelopmentConfig,
      app: {
        ...dataPlaneWorkerFixtureConfig,
        sandbox: {
          ...dataPlaneWorkerFixtureConfig.sandbox,
          docker: {
            ...dataPlaneWorkerFixtureConfig.sandbox.docker,
            socketPath: "/tmp/docker.sock",
          },
        },
      },
    });
  });

  it("rejects data-plane-worker config when the selected sandbox provider is missing worker settings", () => {
    expect(() =>
      loadConfig({
        app: AppIds.DATA_PLANE_WORKER,
        env: createIntegrationEnv({
          NODE_ENV: "production",
          MISTLE_GLOBAL_SANDBOX_PROVIDER: "docker",
          MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SOCKET_PATH: undefined,
          MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_NETWORK_NAME: undefined,
          MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_TRACES_ENDPOINT: undefined,
        }),
      }),
    ).toThrow(
      /apps\.data_plane_worker\.sandbox\.docker is required when global\.sandbox\.provider is 'docker'/,
    );
  });

  it("rejects data-plane-worker config when control-plane API config is missing", () => {
    expect(() =>
      loadConfig({
        app: AppIds.DATA_PLANE_WORKER,
        env: createIntegrationEnv({
          MISTLE_APPS_DATA_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL: undefined,
        }),
      }),
    ).toThrow(/controlPlaneApi/i);
  });

  it("rejects data-plane-worker config when Archil storage is enabled but worker Archil config is missing", () => {
    expect(() =>
      loadConfig({
        app: AppIds.DATA_PLANE_WORKER,
        env: createIntegrationEnv({
          MISTLE_GLOBAL_SANDBOX_STORAGE_BACKEND: "archil",
          MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_API_KEY: undefined,
          MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_REGION: undefined,
          MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_NAME_PREFIX: undefined,
          MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON: undefined,
        }),
      }),
    ).toThrow(
      /apps\.data_plane_worker\.sandbox_storage\.archil is required when global\.sandbox\.storage\.backend is 'archil'/,
    );
  });

  it("loads data-plane-worker config when provider-specific durable storage is omitted and worker storage config is omitted", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_WORKER,
      env: createIntegrationEnv({
        MISTLE_GLOBAL_SANDBOX_STORAGE_BACKEND: undefined,
        MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_API_KEY: undefined,
        MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_REGION: undefined,
        MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_NAME_PREFIX: undefined,
        MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON: undefined,
        MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_DOCKER_VOLUME_NAME_PREFIX: undefined,
      }),
    });

    if (config.global === undefined) {
      throw new Error("Expected global config to be present.");
    }

    expect(config.global.sandbox.storage).toBeUndefined();
    expect(config.app.controlPlaneApi).toEqual({
      baseUrl: "http://127.0.0.1:5000",
    });
    expect(config.app.sandboxStorage).toBeUndefined();
  });

  it("returns only data-plane-worker app config when includeGlobal is false", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_WORKER,
      includeGlobal: false,
      configPath: tomlConfigFixturePath,
    });

    expect(config).toEqual({
      app: dataPlaneWorkerFixtureConfig,
    });
  });

  it("loads tokenizer-proxy purely from a config file fixture", () => {
    const config = loadConfig({
      app: AppIds.TOKENIZER_PROXY,
      configPath: tomlConfigFixturePath,
    });

    expect(config).toEqual({
      global: globalDevelopmentConfig,
      app: tokenizerProxyFixtureConfig,
    });
  });

  it("loads tokenizer-proxy purely from env", () => {
    const config = loadConfig({
      app: AppIds.TOKENIZER_PROXY,
      env: createIntegrationEnv({
        NODE_ENV: "production",
        MISTLE_APPS_TOKENIZER_PROXY_HOST: "localhost",
        MISTLE_APPS_TOKENIZER_PROXY_PORT: "5306",
      }),
    });

    expect(config).toEqual({
      global: globalProductionConfig,
      app: {
        ...tokenizerProxyEnvConfig,
        server: {
          host: "localhost",
          port: 5306,
        },
      },
    });
  });

  it("loads tokenizer-proxy from both config file and env, with env precedence", () => {
    const config = loadConfig({
      app: AppIds.TOKENIZER_PROXY,
      configPath: tomlConfigFixturePath,
      env: {
        MISTLE_APPS_TOKENIZER_PROXY_CONTROL_PLANE_API_BASE_URL: "https://control-plane.local",
        MISTLE_APPS_TOKENIZER_PROXY_CONTROL_PLANE_API_PUBLIC_BASE_URL:
          "https://public-control-plane.local",
      },
    });

    expect(config).toEqual({
      global: globalDevelopmentConfig,
      app: {
        ...tokenizerProxyFixtureConfig,
        controlPlaneApi: {
          baseUrl: "https://control-plane.local",
          publicBaseUrl: "https://public-control-plane.local",
        },
      },
    });
  });

  it("returns only tokenizer-proxy app config when includeGlobal is false", () => {
    const config = loadConfig({
      app: AppIds.TOKENIZER_PROXY,
      includeGlobal: false,
      configPath: tomlConfigFixturePath,
    });

    expect(config).toEqual({
      app: tokenizerProxyFixtureConfig,
    });
  });
});
