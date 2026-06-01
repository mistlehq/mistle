import { describe, expect, it } from "vitest";

import { GatewayWebSocketCloseCodes, GatewayWebSocketCloseReasons } from "./index.js";

describe("gateway websocket close contract", () => {
  it("defines the service restart close code used by gateway-owned websocket peers", () => {
    expect(GatewayWebSocketCloseCodes.SERVICE_RESTART).toBe(4001);
  });

  it("defines the service restart close reason used by gateway-owned websocket peers", () => {
    expect(GatewayWebSocketCloseReasons.SERVICE_RESTART).toBe("service_restart");
  });
});
