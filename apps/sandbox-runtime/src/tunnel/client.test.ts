import { describe, expect, it } from "vitest";

import { classifyTunnelConnectionError } from "./client.js";
import { WebSocketClosedError } from "./websocket.js";

describe("classifyTunnelConnectionError", () => {
  it("retries expected websocket closes", () => {
    expect(classifyTunnelConnectionError(new WebSocketClosedError(1000, ""))).toBe("retry");
    expect(classifyTunnelConnectionError(new WebSocketClosedError(1001, "going away"))).toBe(
      "retry",
    );
  });

  it("fails unexpected websocket and protocol errors", () => {
    expect(classifyTunnelConnectionError(new WebSocketClosedError(1011, "internal error"))).toBe(
      "fail",
    );
    expect(classifyTunnelConnectionError(new Error("invalid tunnel control message"))).toBe("fail");
  });
});
