import { getLocalTestSandboxBaseImageRef } from "@mistle/config";
import { describe, expect, it } from "vitest";

import { createSandboxRuntimeEnv } from "./start-sandbox.js";

const LocalTestSandboxBaseImageRef = getLocalTestSandboxBaseImageRef();

describe("createSandboxRuntimeEnv", () => {
  it("includes the sandboxd test faults env when the worker config enables it", () => {
    const runtimeEnv = createSandboxRuntimeEnv({
      config: {
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
            tokenizerProxyEgressBaseUrl: "http://tokenizer-proxy/tokenizer-proxy/egress",
            sandboxdTestFaultsEnabled: true,
          },
        },
        sandbox: {
          provider: "docker",
          defaultBaseImage: LocalTestSandboxBaseImageRef,
          gatewayWsUrl: "ws://gateway/tunnel/sandbox",
          internalGatewayWsUrl: "ws://gateway/tunnel/sandbox",
          connect: {
            tokenSecret: "connect-secret",
            tokenIssuer: "issuer",
            tokenAudience: "audience",
          },
          bootstrap: {
            tokenSecret: "bootstrap-secret",
            tokenIssuer: "issuer",
            tokenAudience: "audience",
          },
          egress: {
            tokenSecret: "egress-secret",
            tokenIssuer: "issuer",
            tokenAudience: "audience",
          },
          publish: {
            baseDomain: "mistle.example.test",
            access: {
              tokenSecret: "publish-secret",
              tokenIssuer: "issuer",
              tokenAudience: "audience",
            },
            session: {
              cookieSigningSecret: "cookie-secret",
            },
          },
        },
        telemetry: {
          enabled: false,
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
          resourceAttributes: "",
        },
      },
      sandboxInstanceId: "sbi_123",
    });

    expect(runtimeEnv).toEqual({
      SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL:
        "http://tokenizer-proxy/tokenizer-proxy/egress",
      SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID: "sbi_123",
      MISTLE_SANDBOXD_ENABLE_TEST_FAULTS: "1",
    });
  });

  it("omits the sandboxd test faults env when the worker config leaves it disabled", () => {
    const runtimeEnv = createSandboxRuntimeEnv({
      config: {
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
            tokenizerProxyEgressBaseUrl: "http://tokenizer-proxy/tokenizer-proxy/egress",
          },
        },
        sandbox: {
          provider: "docker",
          defaultBaseImage: LocalTestSandboxBaseImageRef,
          gatewayWsUrl: "ws://gateway/tunnel/sandbox",
          internalGatewayWsUrl: "ws://gateway/tunnel/sandbox",
          connect: {
            tokenSecret: "connect-secret",
            tokenIssuer: "issuer",
            tokenAudience: "audience",
          },
          bootstrap: {
            tokenSecret: "bootstrap-secret",
            tokenIssuer: "issuer",
            tokenAudience: "audience",
          },
          egress: {
            tokenSecret: "egress-secret",
            tokenIssuer: "issuer",
            tokenAudience: "audience",
          },
          publish: {
            baseDomain: "mistle.example.test",
            access: {
              tokenSecret: "publish-secret",
              tokenIssuer: "issuer",
              tokenAudience: "audience",
            },
            session: {
              cookieSigningSecret: "cookie-secret",
            },
          },
        },
        telemetry: {
          enabled: false,
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
          resourceAttributes: "",
        },
      },
      sandboxInstanceId: "sbi_123",
    });

    expect(runtimeEnv).toEqual({
      SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL:
        "http://tokenizer-proxy/tokenizer-proxy/egress",
      SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID: "sbi_123",
    });
  });
});
