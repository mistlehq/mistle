import { describe, expect, it } from "vitest";

import { DataPlaneGatewayRelayConfigSchema } from "./schema.js";

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
