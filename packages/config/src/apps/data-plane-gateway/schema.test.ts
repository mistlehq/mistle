import { describe, expect, it } from "vitest";

import {
  DataPlaneGatewayConfigSchema,
  DataPlaneGatewayHealthConfigSchema,
  DataPlaneGatewayRelayConfigSchema,
} from "./schema.js";

function createDataPlaneGatewayConfigInput() {
  return {
    server: {
      host: "0.0.0.0",
      port: 8084,
    },
    database: {
      url: "postgresql://data-plane/mistle",
    },
    runtimeState: {
      backend: "valkey",
      valkey: {
        url: "redis://valkey:6379",
        keyPrefix: "mistle:runtime-state",
      },
    },
    gatewayRelay: {
      backend: "memory",
    },
    dataPlaneApi: {
      baseUrl: "http://data-plane-api:8082",
    },
    controlPlaneApi: {
      baseUrl: "http://control-plane-api:8080",
      publicBaseUrl: "https://api.example.com",
      mcp: {
        auth: {
          secret: "mcp-secret",
          issuer: "control-plane-api",
          audience: "mistle-mcp",
        },
      },
    },
    internalAuth: {
      serviceToken: "service-token",
    },
    sandbox: {
      defaultBaseImage: "registry.example.com/mistle/sandbox-base:prod",
      gatewayWsUrl: "wss://gateway.example.com/tunnel/sandbox",
      internalGatewayWsUrl: "ws://data-plane-gateway:8084/tunnel/sandbox",
      connect: {
        tokenSecret: "connect-secret",
        tokenIssuer: "control-plane-api",
        tokenAudience: "data-plane-gateway",
      },
      bootstrap: {
        tokenSecret: "bootstrap-secret",
        tokenIssuer: "data-plane-worker",
        tokenAudience: "data-plane-gateway",
      },
      egress: {
        tokenSecret: "egress-secret",
        tokenIssuer: "data-plane-gateway",
        tokenAudience: "mistle-gateway-egress",
      },
      ptyTransport: {
        tokenSecret: "pty-secret",
        tokenIssuer: "data-plane-gateway",
        tokenAudience: "mistle-gateway-pty",
      },
      publish: {
        baseDomain: "mistle.example",
        access: {
          tokenSecret: "publish-secret",
          tokenIssuer: "control-plane-api",
          tokenAudience: "data-plane-gateway",
        },
        session: {
          cookieSigningSecret: "publish-cookie-secret",
        },
      },
    },
    telemetry: {
      enabled: false,
      debug: false,
    },
  };
}

describe("DataPlaneGatewayHealthConfigSchema", () => {
  it("defaults websocket health timing when omitted", () => {
    expect(DataPlaneGatewayHealthConfigSchema.parse(undefined)).toEqual({
      websocketPingIntervalMs: 10_000,
      websocketPongTimeoutMs: 10_000,
    });
  });

  it("accepts websocket health timing overrides", () => {
    expect(
      DataPlaneGatewayHealthConfigSchema.parse({
        websocketPingIntervalMs: 100,
        websocketPongTimeoutMs: 250,
      }),
    ).toEqual({
      websocketPingIntervalMs: 100,
      websocketPongTimeoutMs: 250,
    });
  });

  it("rejects non-positive websocket health timing", () => {
    expect(() =>
      DataPlaneGatewayHealthConfigSchema.parse({
        websocketPingIntervalMs: 0,
        websocketPongTimeoutMs: 100,
      }),
    ).toThrow(/websocketPingIntervalMs/u);
  });
});

describe("DataPlaneGatewayConfigSchema", () => {
  it("fills websocket health defaults when the section is omitted", () => {
    expect(DataPlaneGatewayConfigSchema.parse(createDataPlaneGatewayConfigInput()).health).toEqual({
      websocketPingIntervalMs: 10_000,
      websocketPongTimeoutMs: 10_000,
    });
  });
});

describe("DataPlaneGatewayRelayConfigSchema", () => {
  it("accepts the in-memory relay backend without transport config", () => {
    expect(
      DataPlaneGatewayRelayConfigSchema.parse({
        backend: "memory",
      }),
    ).toEqual({
      backend: "memory",
    });
  });

  it("accepts NATS relay config", () => {
    expect(
      DataPlaneGatewayRelayConfigSchema.parse({
        backend: "nats",
        nats: {
          url: "nats://gateway-relay:4222",
          namePrefix: "mistle-prod",
        },
      }),
    ).toEqual({
      backend: "nats",
      nats: {
        url: "nats://gateway-relay:4222",
        namePrefix: "mistle-prod",
      },
    });
  });

  it("rejects NATS relay config without a NATS URL", () => {
    expect(() =>
      DataPlaneGatewayRelayConfigSchema.parse({
        backend: "nats",
        nats: {
          namePrefix: "mistle-prod",
        },
      }),
    ).toThrow(/url/u);
  });

  it("rejects NATS relay config with a non-NATS URL", () => {
    expect(() =>
      DataPlaneGatewayRelayConfigSchema.parse({
        backend: "nats",
        nats: {
          url: "http://gateway-relay:4222",
          namePrefix: "mistle-prod",
        },
      }),
    ).toThrow(/nats/u);
  });
});
