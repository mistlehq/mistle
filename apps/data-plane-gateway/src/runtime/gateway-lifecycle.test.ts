import { createMutableClock } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import { GatewayLifecycle } from "./gateway-lifecycle.js";
import { GatewayWebSocketCloseReasons } from "./gateway-websocket-close.js";

describe("GatewayLifecycle", () => {
  it("starts in serving state", () => {
    const lifecycle = new GatewayLifecycle(createMutableClock(1_000));

    expect(lifecycle.getState()).toEqual({ status: "serving" });
    expect(lifecycle.isServing()).toBe(true);
  });

  it("records service restart drain state with start time", () => {
    const clock = createMutableClock(1_000);
    const lifecycle = new GatewayLifecycle(clock);

    const state = lifecycle.startDrain({
      reason: GatewayWebSocketCloseReasons.SERVICE_RESTART,
    });

    expect(state).toEqual({
      status: "draining",
      reason: "service_restart",
      startedAtMs: 1_000,
    });
    expect(lifecycle.getState()).toEqual(state);
    expect(lifecycle.isServing()).toBe(false);
  });

  it("keeps the original drain state when drain is started more than once", () => {
    const clock = createMutableClock(1_000);
    const lifecycle = new GatewayLifecycle(clock);

    const firstState = lifecycle.startDrain({
      reason: GatewayWebSocketCloseReasons.SERVICE_RESTART,
    });
    clock.advanceMs(500);
    const secondState = lifecycle.startDrain({
      reason: GatewayWebSocketCloseReasons.SERVICE_RESTART,
    });

    expect(secondState).toEqual(firstState);
    expect(lifecycle.getState()).toEqual({
      status: "draining",
      reason: "service_restart",
      startedAtMs: 1_000,
    });
  });
});
