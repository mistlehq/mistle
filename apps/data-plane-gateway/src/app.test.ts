import { createMutableClock } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import { createApp, stopApp } from "./app.js";
import { GatewayForwardingReadiness } from "./runtime/gateway-forwarding-readiness.js";
import { GatewayLifecycle } from "./runtime/gateway-lifecycle.js";
import type { DataPlaneGatewayConfig } from "./types.js";

describe("createApp readiness", () => {
  it("fails readiness while serving when NATS forwarding is still checking", async () => {
    const clock = createMutableClock(1_000);
    const lifecycle = new GatewayLifecycle(clock);
    const forwardingReadiness = new GatewayForwardingReadiness({
      backend: "nats",
      clock,
      localNodeId: "dpg_test",
      subject: "mistle-test.gateway.forward.dpg_test",
    });
    forwardingReadiness.markChecking({ reason: "subscription_started" });
    const app = createApp(createTestConfig(), lifecycle, forwardingReadiness);

    try {
      const response = await app.request("/__readyz");

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        ok: false,
        reason: "subscription_started",
        status: "serving",
        forwarding: {
          lastCheckAtMs: null,
          nodeId: "dpg_test",
          reason: "subscription_started",
          status: "checking",
          subject: "mistle-test.gateway.forward.dpg_test",
        },
      });
    } finally {
      await stopApp(app);
    }
  });

  it("fails readiness while serving when NATS forwarding is not ready", async () => {
    const clock = createMutableClock(1_000);
    const lifecycle = new GatewayLifecycle(clock);
    const forwardingReadiness = new GatewayForwardingReadiness({
      backend: "nats",
      clock,
      localNodeId: "dpg_test",
      subject: "mistle-test.gateway.forward.dpg_test",
    });
    forwardingReadiness.markNotReady({ reason: "self_check_failed" });
    const app = createApp(createTestConfig(), lifecycle, forwardingReadiness);

    try {
      const response = await app.request("/__readyz");

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        ok: false,
        reason: "self_check_failed",
        status: "serving",
        forwarding: {
          lastCheckAtMs: 1_000,
          nodeId: "dpg_test",
          reason: "self_check_failed",
          status: "not_ready",
          subject: "mistle-test.gateway.forward.dpg_test",
        },
      });
    } finally {
      await stopApp(app);
    }
  });
});

function createTestConfig(): DataPlaneGatewayConfig {
  return {
    server: {
      host: "127.0.0.1",
      port: 0,
    },
    database: {
      url: "postgres://unused-data-plane-gateway-readiness-test",
    },
    runtimeState: {
      backend: "memory",
    },
    gatewayRelay: {
      backend: "nats",
      nats: {
        namePrefix: "mistle-test",
        url: "nats://127.0.0.1:4222",
      },
    },
    health: {
      websocketPingIntervalMs: 30_000,
      websocketPongTimeoutMs: 10_000,
    },
    portAccess: {
      authorizationTimeoutMs: 5_000,
    },
    dataPlaneApi: {
      baseUrl: "http://127.0.0.1:1",
    },
    controlPlaneApi: {
      baseUrl: "http://127.0.0.1:1",
      publicBaseUrl: "http://127.0.0.1:1",
      mcp: {
        auth: {
          audience: "mistle-mcp",
          issuer: "control-plane-api",
          secret: "test-mcp-auth-secret",
        },
      },
    },
    internalAuth: {
      serviceToken: "test-internal-service-token",
    },
    platformCredentials: {
      openai: {
        apiKey: "test-openai-api-key",
      },
    },
    sandbox: {
      defaultBaseImage: "test-sandbox-base-image",
      gatewayWsUrl: "ws://127.0.0.1:1/v1/tunnel",
      internalGatewayWsUrl: "ws://127.0.0.1:1/v1/tunnel",
      connect: {
        tokenAudience: "data-plane-gateway",
        tokenIssuer: "control-plane-api",
        tokenSecret: "test-connect-token-secret",
      },
      bootstrap: {
        tokenAudience: "data-plane-gateway",
        tokenIssuer: "data-plane-worker",
        tokenSecret: "test-bootstrap-token-secret",
      },
      egress: {
        tokenAudience: "gateway-egress",
        tokenIssuer: "data-plane-gateway",
        tokenSecret: "test-egress-token-secret",
      },
      ptyTransport: {
        tokenAudience: "gateway-pty",
        tokenIssuer: "data-plane-gateway",
        tokenSecret: "test-pty-token-secret",
      },
      publish: {
        access: {
          tokenAudience: "data-plane-gateway",
          tokenIssuer: "control-plane-api",
          tokenSecret: "test-port-access-token-secret",
        },
        baseDomain: "mistle.localhost",
        session: {
          cookieSigningSecret: "test-port-access-cookie-secret",
        },
      },
    },
    telemetry: {
      debug: false,
      enabled: false,
    },
  };
}
