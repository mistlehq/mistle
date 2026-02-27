import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/loader.js";
import { AppIds } from "../src/modules.js";
import { createIntegrationEnv } from "./fixtures/env.js";

const configFixturePath = fileURLToPath(new URL("./fixtures/config.toml", import.meta.url));
const serviceToken = "fixture-service-token";

const globalDevelopmentConfig = {
  env: "development",
  internalAuth: {
    serviceToken,
  },
} as const;

const globalProductionConfig = {
  env: "production",
  internalAuth: {
    serviceToken,
  },
} as const;

const controlPlaneApiEnvConfig = {
  server: {
    host: "127.0.0.1",
    port: 5000,
  },
  database: {
    url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle_control_plane",
  },
  auth: {
    baseUrl: "http://127.0.0.1:5000",
    invitationAcceptBaseUrl: "http://127.0.0.1:5173/invitations/accept",
    secret: "test-secret",
    trustedOrigins: ["http://127.0.0.1:3000"],
    otpLength: 6,
    otpExpiresInSeconds: 300,
    otpAllowedAttempts: 3,
  },
  workflow: {
    databaseUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle_control_plane",
    namespaceId: "development",
  },
} as const;

const controlPlaneApiFixtureConfig = {
  ...controlPlaneApiEnvConfig,
  server: {
    host: "0.0.0.0",
    port: 5100,
  },
  workflow: {
    ...controlPlaneApiEnvConfig.workflow,
    namespaceId: "fixture",
  },
} as const;

const controlPlaneWorkerEnvConfig = {
  server: {
    host: "127.0.0.1",
    port: 5001,
  },
  workflow: {
    databaseUrl: "postgresql://mistle:mistle@127.0.0.1:5432/mistle_control_plane",
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
} as const;

const controlPlaneWorkerFixtureConfig = {
  ...controlPlaneWorkerEnvConfig,
  server: {
    host: "0.0.0.0",
    port: 5200,
  },
  workflow: {
    ...controlPlaneWorkerEnvConfig.workflow,
    namespaceId: "fixture",
    concurrency: 2,
  },
} as const;

const dataPlaneApiEnvConfig = {
  server: {
    host: "127.0.0.1",
    port: 5002,
  },
  database: {
    url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle_data_plane",
  },
  workflow: {
    databaseUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle_data_plane",
    namespaceId: "development",
  },
} as const;

const dataPlaneApiFixtureConfig = {
  ...dataPlaneApiEnvConfig,
  server: {
    host: "0.0.0.0",
    port: 5300,
  },
  workflow: {
    ...dataPlaneApiEnvConfig.workflow,
    namespaceId: "fixture",
  },
} as const;

const dataPlaneGatewayEnvConfig = {
  server: {
    host: "127.0.0.1",
    port: 5003,
  },
} as const;

const dataPlaneGatewayFixtureConfig = {
  ...dataPlaneGatewayEnvConfig,
  server: {
    host: "0.0.0.0",
    port: 5302,
  },
} as const;

const dataPlaneWorkerEnvConfig = {
  server: {
    host: "127.0.0.1",
    port: 5004,
  },
  database: {
    url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle_data_plane",
  },
  workflow: {
    databaseUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle_data_plane",
    namespaceId: "development",
    runMigrations: true,
    concurrency: 1,
  },
  sandbox: {
    provider: "modal",
    modal: {
      tokenId: "fixture-modal-token-id",
      tokenSecret: "fixture-modal-token-secret",
      appName: "mistle-sandbox",
      environmentName: "development",
    },
  },
} as const;

const dataPlaneWorkerFixtureConfig = {
  ...dataPlaneWorkerEnvConfig,
  server: {
    host: "0.0.0.0",
    port: 5303,
  },
  workflow: {
    ...dataPlaneWorkerEnvConfig.workflow,
    namespaceId: "fixture",
    concurrency: 2,
  },
} as const;

describe("loadConfig integrations", () => {
  it("loads control-plane-api purely from a config file fixture", () => {
    const config = loadConfig({
      app: AppIds.CONTROL_PLANE_API,
      configPath: configFixturePath,
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
      configPath: configFixturePath,
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
      configPath: configFixturePath,
    });

    expect(config).toEqual({
      app: controlPlaneApiFixtureConfig,
    });
  });

  it("loads control-plane-worker purely from a config file fixture", () => {
    const config = loadConfig({
      app: AppIds.CONTROL_PLANE_WORKER,
      configPath: configFixturePath,
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
        MISTLE_APPS_CONTROL_PLANE_WORKER_HOST: "localhost",
        MISTLE_APPS_CONTROL_PLANE_WORKER_PORT: "5301",
      }),
    });

    expect(config).toEqual({
      global: globalProductionConfig,
      app: {
        ...controlPlaneWorkerEnvConfig,
        server: {
          host: "localhost",
          port: 5301,
        },
      },
    });
  });

  it("loads control-plane-worker from both config file and env, with env precedence", () => {
    const config = loadConfig({
      app: AppIds.CONTROL_PLANE_WORKER,
      configPath: configFixturePath,
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
      configPath: configFixturePath,
    });

    expect(config).toEqual({
      app: controlPlaneWorkerFixtureConfig,
    });
  });

  it("loads data-plane-api purely from a config file fixture", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_API,
      configPath: configFixturePath,
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

  it("loads data-plane-api from both config file and env, with env precedence", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_API,
      configPath: configFixturePath,
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
      configPath: configFixturePath,
    });

    expect(config).toEqual({
      app: dataPlaneApiFixtureConfig,
    });
  });

  it("loads data-plane-gateway purely from a config file fixture", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_GATEWAY,
      configPath: configFixturePath,
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

  it("loads data-plane-gateway from both config file and env, with env precedence", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_GATEWAY,
      configPath: configFixturePath,
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
      configPath: configFixturePath,
    });

    expect(config).toEqual({
      app: dataPlaneGatewayFixtureConfig,
    });
  });

  it("loads data-plane-worker purely from a config file fixture", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_WORKER,
      configPath: configFixturePath,
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
        MISTLE_APPS_DATA_PLANE_WORKER_HOST: "localhost",
        MISTLE_APPS_DATA_PLANE_WORKER_PORT: "5304",
      }),
    });

    expect(config).toEqual({
      global: globalProductionConfig,
      app: {
        ...dataPlaneWorkerEnvConfig,
        server: {
          host: "localhost",
          port: 5304,
        },
      },
    });
  });

  it("loads data-plane-worker from both config file and env, with env precedence", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_WORKER,
      configPath: configFixturePath,
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

  it("returns only data-plane-worker app config when includeGlobal is false", () => {
    const config = loadConfig({
      app: AppIds.DATA_PLANE_WORKER,
      includeGlobal: false,
      configPath: configFixturePath,
    });

    expect(config).toEqual({
      app: dataPlaneWorkerFixtureConfig,
    });
  });
});
