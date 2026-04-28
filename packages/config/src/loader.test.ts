import { describe, expect, it } from "vitest";

import { loadConfig, parseConfigRecord } from "./loader.js";
import { AppIds } from "./modules.js";
import { getLocalDevDockerRegistrySandboxBaseImageRef } from "./sandbox-base-images.js";

const LocalDevDockerRegistrySandboxBaseImageRef = getLocalDevDockerRegistrySandboxBaseImageRef();
const DataPlaneGatewaySharedAppConfig = {
  internalAuth: {
    serviceToken: "test-service-token",
  },
  sandbox: {
    provider: "docker",
    defaultBaseImage: LocalDevDockerRegistrySandboxBaseImageRef,
    gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
    internalGatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
    connect: {
      tokenSecret: "test-connection-token-secret",
      tokenIssuer: "control-plane-api",
      tokenAudience: "data-plane-gateway",
    },
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
    publish: {
      baseDomain: "mistle.example.test",
      access: {
        tokenSecret: "test-publish-token-secret",
        tokenIssuer: "control-plane-api",
        tokenAudience: "data-plane-gateway",
      },
      session: {
        cookieSigningSecret: "test-publish-cookie-secret",
      },
    },
  },
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
};

const DataPlaneWorkerSharedSandboxConfig = {
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
};

const DataPlaneWorkerSharedAppConfig = {
  internalAuth: {
    serviceToken: "test-service-token",
  },
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
};

describe("parseConfigRecord", () => {
  it("parses a minimal config record", () => {
    const configRecord = {
      global: {
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
          serviceToken: "test-service-token",
        },
        sandbox: {
          provider: "docker",
          defaultBaseImage: LocalDevDockerRegistrySandboxBaseImageRef,
          gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
          internalGatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
          connect: {
            tokenSecret: "test-connection-token-secret",
            tokenIssuer: "control-plane-api",
            tokenAudience: "data-plane-gateway",
          },
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
          publish: {
            baseDomain: "mistle.example.test",
            access: {
              tokenSecret: "test-publish-token-secret",
              tokenIssuer: "control-plane-api",
              tokenAudience: "data-plane-gateway",
            },
            session: {
              cookieSigningSecret: "test-publish-cookie-secret",
            },
          },
        },
      },
      apps: {
        control_plane_api: {
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
            baseUrl: "http://127.0.0.1:5200",
          },
          internalAuth: {
            serviceToken: "test-service-token",
          },
          connectionToken: {
            secret: "test-connection-token-secret",
            issuer: "control-plane-api",
            audience: "data-plane-gateway",
          },
          portAccess: {
            baseDomain: "mistle.example.test",
            gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
            access: {
              tokenSecret: "test-publish-token-secret",
              tokenIssuer: "control-plane-api",
              tokenAudience: "data-plane-gateway",
            },
          },
          sandbox: {
            defaultBaseImage: LocalDevDockerRegistrySandboxBaseImageRef,
            gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
            bootstrap: {
              tokenSecret: "test-bootstrap-token-secret",
              tokenIssuer: "data-plane-worker",
              tokenAudience: "data-plane-gateway",
            },
          },
          integrations: {
            activeMasterEncryptionKeyVersion: 1,
            masterEncryptionKeys: {
              "1": "integration-master-key-test",
            },
          },
        },
        control_plane_worker: {
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
            baseUrl: "http://127.0.0.1:5200",
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5000",
          },
          internalAuth: {
            serviceToken: "test-service-token",
          },
        },
        data_plane_api: {
          server: {
            host: "127.0.0.1",
            port: 5200,
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
            gatewayBaseUrl: "http://127.0.0.1:5202",
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5100",
          },
          internalAuth: {
            serviceToken: "test-service-token",
          },
          sandbox: {
            provider: "docker",
            docker: {
              socketPath: "/var/run/docker.sock",
            },
          },
        },
        data_plane_worker: {
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
            gatewayBaseUrl: "http://127.0.0.1:5202",
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5100",
          },
          ...DataPlaneWorkerSharedAppConfig,
          sandbox: {
            ...DataPlaneWorkerSharedSandboxConfig,
            tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
            docker: {
              socketPath: "/var/run/docker.sock",
              networkName: "mistle-sandbox-dev",
            },
          },
        },
        data_plane_gateway: {
          server: {
            host: "127.0.0.1",
            port: 5202,
          },
          database: {
            url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
          },
          runtimeState: {
            backend: "valkey",
            valkey: {
              url: "redis://127.0.0.1:6379",
              keyPrefix: "mistle:runtime-state:test",
            },
          },
          dataPlaneApi: {
            baseUrl: "http://127.0.0.1:5200",
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5000",
          },
          ...DataPlaneGatewaySharedAppConfig,
        },
        tokenizer_proxy: {
          server: {
            host: "127.0.0.1",
            port: 5205,
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5100",
            publicBaseUrl: "https://mistle.example.test",
          },
          internalAuth: {
            serviceToken: "test-service-token",
          },
          egressGrant: {
            tokenSecret: "test-egress-token-secret",
            tokenIssuer: "data-plane-worker",
            tokenAudience: "tokenizer-proxy",
          },
        },
      },
    };
    const config = parseConfigRecord(configRecord);

    expect(config).toEqual(configRecord);
  });

  it("parses a config record with docker sandbox provider", () => {
    const configRecord = {
      global: {
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
          serviceToken: "test-service-token",
        },
        sandbox: {
          provider: "docker",
          defaultBaseImage: LocalDevDockerRegistrySandboxBaseImageRef,
          gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
          internalGatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
          connect: {
            tokenSecret: "test-connection-token-secret",
            tokenIssuer: "control-plane-api",
            tokenAudience: "data-plane-gateway",
          },
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
          publish: {
            baseDomain: "mistle.example.test",
            access: {
              tokenSecret: "test-publish-token-secret",
              tokenIssuer: "control-plane-api",
              tokenAudience: "data-plane-gateway",
            },
            session: {
              cookieSigningSecret: "test-publish-cookie-secret",
            },
          },
        },
      },
      apps: {
        control_plane_api: {
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
            baseUrl: "http://127.0.0.1:5200",
          },
          internalAuth: {
            serviceToken: "test-service-token",
          },
          connectionToken: {
            secret: "test-connection-token-secret",
            issuer: "control-plane-api",
            audience: "data-plane-gateway",
          },
          portAccess: {
            baseDomain: "mistle.example.test",
            gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
            access: {
              tokenSecret: "test-publish-token-secret",
              tokenIssuer: "control-plane-api",
              tokenAudience: "data-plane-gateway",
            },
          },
          sandbox: {
            defaultBaseImage: LocalDevDockerRegistrySandboxBaseImageRef,
            gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
            bootstrap: {
              tokenSecret: "test-bootstrap-token-secret",
              tokenIssuer: "data-plane-worker",
              tokenAudience: "data-plane-gateway",
            },
          },
          integrations: {
            activeMasterEncryptionKeyVersion: 1,
            masterEncryptionKeys: {
              "1": "integration-master-key-test",
            },
          },
        },
        control_plane_worker: {
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
            baseUrl: "http://127.0.0.1:5200",
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5000",
          },
          internalAuth: {
            serviceToken: "test-service-token",
          },
        },
        data_plane_api: {
          server: {
            host: "127.0.0.1",
            port: 5200,
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
            gatewayBaseUrl: "http://127.0.0.1:5202",
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5100",
          },
          internalAuth: {
            serviceToken: "test-service-token",
          },
          sandbox: {
            provider: "docker",
            docker: {
              socketPath: "/var/run/docker.sock",
            },
          },
        },
        data_plane_worker: {
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
            gatewayBaseUrl: "http://127.0.0.1:5202",
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5100",
          },
          ...DataPlaneWorkerSharedAppConfig,
          sandbox: {
            ...DataPlaneWorkerSharedSandboxConfig,
            tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
            docker: {
              socketPath: "/var/run/docker.sock",
              networkName: "mistle-sandbox-dev",
            },
          },
        },
        data_plane_gateway: {
          server: {
            host: "127.0.0.1",
            port: 5202,
          },
          database: {
            url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
          },
          runtimeState: {
            backend: "valkey",
            valkey: {
              url: "redis://127.0.0.1:6379",
              keyPrefix: "mistle:runtime-state:test",
            },
          },
          dataPlaneApi: {
            baseUrl: "http://127.0.0.1:5200",
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5000",
          },
          ...DataPlaneGatewaySharedAppConfig,
        },
        tokenizer_proxy: {
          server: {
            host: "127.0.0.1",
            port: 5205,
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5100",
            publicBaseUrl: "https://mistle.example.test",
          },
          internalAuth: {
            serviceToken: "test-service-token",
          },
          egressGrant: {
            tokenSecret: "test-egress-token-secret",
            tokenIssuer: "data-plane-worker",
            tokenAudience: "tokenizer-proxy",
          },
        },
      },
    };
    const config = parseConfigRecord(configRecord);

    expect(config).toEqual(configRecord);
  });

  it("rejects a config record when the selected sandbox provider is missing worker settings", () => {
    const configRecord = {
      global: {
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
          serviceToken: "test-service-token",
        },
        sandbox: {
          provider: "docker",
          defaultBaseImage: LocalDevDockerRegistrySandboxBaseImageRef,
          gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
          internalGatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
          connect: {
            tokenSecret: "test-connection-token-secret",
            tokenIssuer: "control-plane-api",
            tokenAudience: "data-plane-gateway",
          },
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
          publish: {
            baseDomain: "mistle.example.test",
            access: {
              tokenSecret: "test-publish-token-secret",
              tokenIssuer: "control-plane-api",
              tokenAudience: "data-plane-gateway",
            },
            session: {
              cookieSigningSecret: "test-publish-cookie-secret",
            },
          },
        },
      },
      apps: {
        control_plane_api: {
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
            namespaceId: "development",
          },
          dataPlaneApi: {
            baseUrl: "http://127.0.0.1:5200",
          },
          internalAuth: {
            serviceToken: "test-service-token",
          },
          connectionToken: {
            secret: "test-connection-token-secret",
            issuer: "control-plane-api",
            audience: "data-plane-gateway",
          },
          portAccess: {
            baseDomain: "mistle.example.test",
            gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
            access: {
              tokenSecret: "test-publish-token-secret",
              tokenIssuer: "control-plane-api",
              tokenAudience: "data-plane-gateway",
            },
          },
          sandbox: {
            defaultBaseImage: LocalDevDockerRegistrySandboxBaseImageRef,
            gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
            bootstrap: {
              tokenSecret: "test-bootstrap-token-secret",
              tokenIssuer: "data-plane-worker",
              tokenAudience: "data-plane-gateway",
            },
          },
          integrations: {
            activeMasterEncryptionKeyVersion: 1,
            masterEncryptionKeys: {
              "1": "integration-master-key-test",
            },
          },
        },
        control_plane_worker: {
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
            baseUrl: "http://127.0.0.1:5200",
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5000",
          },
          internalAuth: {
            serviceToken: "test-service-token",
          },
        },
        data_plane_api: {
          server: {
            host: "127.0.0.1",
            port: 5200,
          },
          database: {
            url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
            migrationUrl: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
          },
          workflow: {
            databaseUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
            namespaceId: "development",
          },
          runtimeState: {
            gatewayBaseUrl: "http://127.0.0.1:5202",
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5100",
          },
          internalAuth: {
            serviceToken: "test-service-token",
          },
          sandbox: {
            provider: "docker",
            docker: {
              socketPath: "/var/run/docker.sock",
            },
          },
        },
        data_plane_worker: {
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
            gatewayBaseUrl: "http://127.0.0.1:5202",
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5100",
          },
          ...DataPlaneWorkerSharedAppConfig,
          sandbox: {
            ...DataPlaneWorkerSharedSandboxConfig,
            tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
          },
        },
        data_plane_gateway: {
          server: {
            host: "127.0.0.1",
            port: 5202,
          },
          database: {
            url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
          },
          runtimeState: {
            backend: "valkey",
            valkey: {
              url: "redis://127.0.0.1:6379",
              keyPrefix: "mistle:runtime-state:test",
            },
          },
          dataPlaneApi: {
            baseUrl: "http://127.0.0.1:5200",
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5000",
          },
          ...DataPlaneGatewaySharedAppConfig,
        },
        tokenizer_proxy: {
          server: {
            host: "127.0.0.1",
            port: 5205,
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5100",
            publicBaseUrl: "https://mistle.example.test",
          },
          internalAuth: {
            serviceToken: "test-service-token",
          },
          egressGrant: {
            tokenSecret: "test-egress-token-secret",
            tokenIssuer: "data-plane-worker",
            tokenAudience: "tokenizer-proxy",
          },
        },
      },
    };

    expect(() => parseConfigRecord(configRecord)).toThrow(
      /apps\.data_plane_worker\.sandbox\.docker is required when apps\.data_plane_worker\.sandbox\.provider is 'docker'/,
    );
  });

  it("rejects a config record when the data-plane API control-plane URL is missing", () => {
    expect(() =>
      parseConfigRecord({
        global: {
          env: "development",
          telemetry: {
            enabled: true,
            debug: false,
            traces: { endpoint: "http://127.0.0.1:4318/v1/traces" },
            logs: { endpoint: "http://127.0.0.1:4318/v1/logs" },
            metrics: { endpoint: "http://127.0.0.1:4318/v1/metrics" },
          },
          internalAuth: {
            serviceToken: "test-service-token",
          },
          sandbox: {
            provider: "docker",
            defaultBaseImage: LocalDevDockerRegistrySandboxBaseImageRef,
            gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
            internalGatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
            connect: {
              tokenSecret: "test-connect-token-secret",
              tokenIssuer: "control-plane-api",
              tokenAudience: "data-plane-gateway",
            },
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
            publish: {
              baseDomain: "mistle.example.test",
              access: {
                tokenSecret: "test-publish-token-secret",
                tokenIssuer: "control-plane-api",
                tokenAudience: "data-plane-gateway",
              },
              session: {
                cookieSigningSecret: "test-publish-cookie-secret",
              },
            },
          },
        },
        apps: {
          control_plane_api: {
            server: { host: "127.0.0.1", port: 5000 },
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
              namespaceId: "development",
            },
            dataPlaneApi: {
              baseUrl: "http://127.0.0.1:5200",
            },
            internalAuth: {
              serviceToken: "test-service-token",
            },
            connectionToken: {
              secret: "test-connection-token-secret",
              issuer: "control-plane-api",
              audience: "data-plane-gateway",
            },
            portAccess: {
              baseDomain: "mistle.example.test",
              gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
              access: {
                tokenSecret: "test-publish-token-secret",
                tokenIssuer: "control-plane-api",
                tokenAudience: "data-plane-gateway",
              },
            },
            sandbox: {
              defaultBaseImage: LocalDevDockerRegistrySandboxBaseImageRef,
              gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
              bootstrap: {
                tokenSecret: "test-bootstrap-token-secret",
                tokenIssuer: "data-plane-worker",
                tokenAudience: "data-plane-gateway",
              },
            },
            integrations: {
              activeMasterEncryptionKeyVersion: 1,
              masterEncryptionKeys: {
                "1": "integration-master-key-test",
              },
            },
          },
          control_plane_worker: {
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
              baseUrl: "http://127.0.0.1:5200",
            },
            controlPlaneApi: {
              baseUrl: "http://127.0.0.1:5000",
            },
            internalAuth: {
              serviceToken: "test-service-token",
            },
          },
          data_plane_api: {
            server: { host: "127.0.0.1", port: 5200 },
            database: {
              url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
              migrationUrl: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
            },
            workflow: {
              databaseUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
              namespaceId: "development",
            },
            runtimeState: {
              gatewayBaseUrl: "http://127.0.0.1:5202",
            },
            controlPlaneApi: {
              baseUrl: "http://127.0.0.1:5100",
            },
            internalAuth: {
              serviceToken: "test-service-token",
            },
            sandbox: {
              provider: "docker",
              docker: {
                socketPath: "/var/run/docker.sock",
              },
            },
          },
          data_plane_worker: {
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
              gatewayBaseUrl: "http://127.0.0.1:5202",
            },
            controlPlaneApi: {
              baseUrl: "http://127.0.0.1:5000",
            },
            ...DataPlaneWorkerSharedAppConfig,
            sandbox: {
              ...DataPlaneWorkerSharedSandboxConfig,
              tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
              docker: {
                socketPath: "/var/run/docker.sock",
              },
            },
            sandboxStorage: {
              archil: {
                apiKey: "archil-api-key",
                region: "gcp-us-central1",
                mounts: [
                  {
                    type: "s3-compatible",
                    bucket: "mistle-sandbox-storage",
                    endpoint: "https://s3.example.com",
                    accessKeyId: "access-key-id",
                    secretAccessKey: "secret-access-key",
                  },
                ],
              },
            },
          },
          data_plane_gateway: {
            server: { host: "127.0.0.1", port: 5202 },
            database: {
              url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
            },
            runtimeState: {
              backend: "valkey",
              valkey: {
                url: "redis://127.0.0.1:6379",
                keyPrefix: "mistle:runtime-state:test",
              },
            },
            dataPlaneApi: {
              baseUrl: "http://127.0.0.1:5200",
            },
          },
          tokenizer_proxy: {
            server: { host: "127.0.0.1", port: 5205 },
            controlPlaneApi: {
              baseUrl: "http://127.0.0.1:5100",
              publicBaseUrl: "https://mistle.example.test",
            },
            internalAuth: {
              serviceToken: "test-service-token",
            },
            egressGrant: {
              tokenSecret: "test-egress-token-secret",
              tokenIssuer: "data-plane-worker",
              tokenAudience: "tokenizer-proxy",
            },
          },
        },
      }),
    ).toThrow(/controlPlaneApi/);
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

  it("loads data-plane worker env config by composing shared dependencies into the app config", () => {
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

    expect(loadedConfig).toEqual({
      app: {
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
          ...DataPlaneWorkerSharedSandboxConfig,
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
      },
    });
  });
});
