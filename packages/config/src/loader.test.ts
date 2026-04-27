import { describe, expect, it } from "vitest";

import { loadConfig, parseConfigRecord } from "./loader.js";
import { AppIds } from "./modules.js";
import { getLocalDevDockerRegistrySandboxBaseImageRef } from "./sandbox-base-images.js";

const LocalDevDockerRegistrySandboxBaseImageRef = getLocalDevDockerRegistrySandboxBaseImageRef();

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
          sandbox: {
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
          sandbox: {
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
          sandbox: {
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
          sandbox: {
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
          sandbox: {
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
          sandbox: {
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
        },
      },
    };

    expect(() => parseConfigRecord(configRecord)).toThrow(
      /apps\.data_plane_worker\.sandbox\.docker is required when global\.sandbox\.provider is 'docker'/,
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
            sandbox: {
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
            sandbox: {
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
});
