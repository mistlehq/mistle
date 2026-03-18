import { describe, expect, it } from "vitest";

import { toTunnelForwardPayload } from "./tunnel-websocket-message-handler.js";

describe("toTunnelForwardPayload", () => {
  it("returns string payloads unchanged", () => {
    expect(toTunnelForwardPayload("hello")).toBe("hello");
  });

  it("returns array buffer payloads unchanged", () => {
    const payload = new Uint8Array([1, 2, 3]).buffer;

    expect(toTunnelForwardPayload(payload)).toBe(payload);
  });
});
