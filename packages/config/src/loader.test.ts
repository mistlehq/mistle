import { describe, expect, it } from "vitest";

import { loadConfig, parseConfigRecord } from "./loader.js";
import { AppIds } from "./modules.js";

describe("parseConfigRecord", () => {
  it("parses a minimal config record", () => {
    const configRecord = {
      global: {
        env: "development",
        internalAuth: {
          serviceToken: "test-service-token",
        },
        sandbox: {
          defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
          gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
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
          server: {
            host: "127.0.0.1",
            port: 5100,
          },
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
          },
          workflow: {
            databaseUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
            namespaceId: "development",
          },
        },
        data_plane_worker: {
          server: {
            host: "127.0.0.1",
            port: 5201,
          },
          database: {
            url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
          },
          workflow: {
            databaseUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
            namespaceId: "development",
            runMigrations: true,
            concurrency: 1,
          },
          tunnel: {
            gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
            bootstrapTokenTtlSeconds: 120,
          },
          sandbox: {
            provider: "modal",
            tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
            modal: {
              tokenId: "fixture-modal-token-id",
              tokenSecret: "fixture-modal-token-secret",
              appName: "mistle-sandbox",
              environmentName: "development",
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
        },
        tokenizer_proxy: {
          server: {
            host: "127.0.0.1",
            port: 5205,
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5100",
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
        internalAuth: {
          serviceToken: "test-service-token",
        },
        sandbox: {
          defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
          gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
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
          server: {
            host: "127.0.0.1",
            port: 5100,
          },
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
          },
          workflow: {
            databaseUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
            namespaceId: "development",
          },
        },
        data_plane_worker: {
          server: {
            host: "127.0.0.1",
            port: 5201,
          },
          database: {
            url: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
          },
          workflow: {
            databaseUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
            namespaceId: "development",
            runMigrations: true,
            concurrency: 1,
          },
          tunnel: {
            gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
            bootstrapTokenTtlSeconds: 120,
          },
          sandbox: {
            provider: "docker",
            tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
            docker: {
              socketPath: "/var/run/docker.sock",
              snapshotRepository: "localhost:5001/mistle/snapshots",
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
        },
        tokenizer_proxy: {
          server: {
            host: "127.0.0.1",
            port: 5205,
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5100",
          },
        },
      },
    };
    const config = parseConfigRecord(configRecord);

    expect(config).toEqual(configRecord);
  });
});

describe("loadConfig", () => {
  it("fails when configPath and env are both missing", () => {
    expect(() =>
      loadConfig({
        app: AppIds.CONTROL_PLANE_API,
      }),
    ).toThrowError(/Missing config source/);
  });
});
