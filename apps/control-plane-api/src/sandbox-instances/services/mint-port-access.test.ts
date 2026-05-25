import { describe, expect, it } from "vitest";

import { buildPortAccessBootstrapUrl } from "./mint-port-access.js";

describe("buildPortAccessBootstrapUrl", () => {
  it("uses the gateway websocket scheme and port for browser bootstrap URLs", () => {
    const url = new URL(
      buildPortAccessBootstrapUrl({
        gatewayWsUrl: "ws://localhost:5202/tunnel/sandbox",
        host: "p-4321--sandbox.mistle.localhost",
        bootstrapPath: "/_mistle/access/bootstrap",
        token: "header.payload.signature",
      }),
    );

    expect(url.protocol).toBe("http:");
    expect(url.hostname).toBe("p-4321--sandbox.mistle.localhost");
    expect(url.port).toBe("5202");
    expect(url.pathname).toBe("/_mistle/access/bootstrap");
    expect(url.searchParams.get("token")).toBe("header.payload.signature");
  });

  it("uses https for secure gateway websocket URLs", () => {
    const url = new URL(
      buildPortAccessBootstrapUrl({
        gatewayWsUrl: "wss://gateway.mistle.example/tunnel/sandbox",
        host: "p-4321--sandbox.mistle.example",
        bootstrapPath: "/_mistle/access/bootstrap",
        token: "header.payload.signature",
      }),
    );

    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("p-4321--sandbox.mistle.example");
    expect(url.port).toBe("");
  });
});
