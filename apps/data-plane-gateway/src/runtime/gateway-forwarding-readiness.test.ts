import { createMutableClock } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import { GatewayForwardingReadiness } from "./gateway-forwarding-readiness.js";

describe("GatewayForwardingReadiness", () => {
  it("starts not ready while forwarding has not been checked", () => {
    const readiness = new GatewayForwardingReadiness({
      backend: "nats",
      clock: createMutableClock(1_000),
      localNodeId: "gateway-a",
      subject: "mistle.gateway.forward.gateway-a",
    });

    expect(readiness.getState()).toEqual({
      changedAtMs: 1_000,
      lastCheckAtMs: undefined,
      reason: "startup",
      status: "not_ready",
    });
    expect(readiness.isReady()).toBe(false);
  });

  it("records checking and ready transitions with the transition time", () => {
    const clock = createMutableClock(1_000);
    const readiness = new GatewayForwardingReadiness({
      backend: "nats",
      clock,
      localNodeId: "gateway-a",
      subject: "mistle.gateway.forward.gateway-a",
    });

    clock.advanceMs(50);
    readiness.markChecking({ reason: "subscription_started" });
    expect(readiness.getState()).toEqual({
      changedAtMs: 1_050,
      lastCheckAtMs: undefined,
      reason: "subscription_started",
      status: "checking",
    });
    expect(readiness.isReady()).toBe(false);

    clock.advanceMs(25);
    readiness.markReady({ reason: "self_check_succeeded" });
    expect(readiness.getState()).toEqual({
      changedAtMs: 1_075,
      lastCheckAtMs: 1_075,
      reason: "self_check_succeeded",
      status: "ready",
    });
    expect(readiness.isReady()).toBe(true);
  });

  it("records not ready transitions when the subscription exits", () => {
    const clock = createMutableClock(1_000);
    const readiness = new GatewayForwardingReadiness({
      backend: "nats",
      clock,
      localNodeId: "gateway-a",
      subject: "mistle.gateway.forward.gateway-a",
    });
    readiness.markChecking({ reason: "subscription_started" });
    readiness.markReady({ reason: "self_check_succeeded" });

    clock.advanceMs(100);
    readiness.markNotReady({ reason: "subscription_exited" });

    expect(readiness.getState()).toEqual({
      changedAtMs: 1_100,
      lastCheckAtMs: 1_000,
      reason: "subscription_exited",
      status: "not_ready",
    });
    expect(readiness.isReady()).toBe(false);
  });

  it("updates the last check time when a repeated check does not change status", () => {
    const clock = createMutableClock(1_000);
    const readiness = new GatewayForwardingReadiness({
      backend: "nats",
      clock,
      localNodeId: "gateway-a",
      subject: "mistle.gateway.forward.gateway-a",
    });
    readiness.markChecking({ reason: "subscription_started" });
    readiness.markReady({ reason: "self_check_succeeded" });

    clock.advanceMs(250);
    readiness.markReady({ reason: "self_check_succeeded" });

    expect(readiness.getState()).toEqual({
      changedAtMs: 1_000,
      lastCheckAtMs: 1_250,
      reason: "self_check_succeeded",
      status: "ready",
    });
  });
});
