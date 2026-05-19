import { describe, expect, it } from "vitest";

import { createGatewayWsUrl } from "./data-plane-gateway-sandbox-url.js";
import type { PeerResolver } from "./peers.js";
import { ServiceIds, type ServiceId } from "./service-ids.js";

describe("createGatewayWsUrl", () => {
  it("uses the Docker host gateway for sandbox-reachable gateway transport URLs", () => {
    expect(
      createGatewayWsUrl({
        sandbox: {
          provider: "docker",
        },
        peer: createPeerResolver("ws://127.0.0.1:52123"),
      }),
    ).toBe("ws://host.docker.internal:52123/tunnel/sandbox");
  });

  it("uses the public gateway URL when the sandbox provider requires public access", () => {
    expect(
      createGatewayWsUrl({
        sandbox: {
          provider: "e2b",
          publicServiceBaseUrls: new Map([
            [ServiceIds.DATA_PLANE_GATEWAY, "https://data-plane-gateway-dev.example.com"],
          ]),
        },
        peer: createPeerResolver("ws://127.0.0.1:52123"),
      }),
    ).toBe("wss://data-plane-gateway-dev.example.com/tunnel/sandbox");
  });

  it("uses the harness-local gateway URL when no sandbox runtime is configured", () => {
    expect(
      createGatewayWsUrl({
        sandbox: undefined,
        peer: createPeerResolver("ws://127.0.0.1:52123"),
      }),
    ).toBe("ws://127.0.0.1:52123/tunnel/sandbox");
  });
});

function createPeerResolver(baseUrl: string): Pick<PeerResolver, "ws"> {
  return {
    ws: (serviceId: ServiceId, path: string): string => {
      if (serviceId !== ServiceIds.DATA_PLANE_GATEWAY) {
        throw new Error(`Unexpected peer service id '${serviceId}'.`);
      }

      const url = new URL(path, baseUrl);
      return url.toString();
    },
  };
}
