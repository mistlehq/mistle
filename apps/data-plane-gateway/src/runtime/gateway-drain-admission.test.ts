import { createMutableClock } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import {
  GatewayDrainingRejectionCode,
  GatewayDrainingRejectionMessage,
  createGatewayDrainingAdmissionResponse,
} from "./gateway-drain-admission.js";
import { GatewayLifecycle } from "./gateway-lifecycle.js";
import { GatewayWebSocketCloseReasons } from "./gateway-websocket-close.js";

describe("gateway drain admission", () => {
  it("allows admission while the gateway is serving", () => {
    const lifecycle = new GatewayLifecycle(createMutableClock());

    expect(
      createGatewayDrainingAdmissionResponse({
        lifecycle,
        responseKind: "json",
      }),
    ).toBeUndefined();
  });

  it("rejects JSON admission with the stable gateway draining contract", async () => {
    const lifecycle = new GatewayLifecycle(createMutableClock());
    lifecycle.startDrain({
      reason: GatewayWebSocketCloseReasons.SERVICE_RESTART,
    });

    const response = createGatewayDrainingAdmissionResponse({
      lifecycle,
      responseKind: "json",
    });

    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({
      error: GatewayDrainingRejectionCode,
      message: GatewayDrainingRejectionMessage,
    });
  });

  it("rejects text admission with the stable gateway draining contract", async () => {
    const lifecycle = new GatewayLifecycle(createMutableClock());
    lifecycle.startDrain({
      reason: GatewayWebSocketCloseReasons.SERVICE_RESTART,
    });

    const response = createGatewayDrainingAdmissionResponse({
      lifecycle,
      responseKind: "text",
    });

    expect(response?.status).toBe(503);
    expect(await response?.text()).toBe(
      `${GatewayDrainingRejectionCode}: ${GatewayDrainingRejectionMessage}`,
    );
  });
});
