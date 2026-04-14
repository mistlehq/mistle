import { describe, expect, it } from "vitest";

import {
  DefaultDataPlaneGatewayLifecycleDurations,
  resolveDataPlaneGatewayLifecycleDurations,
} from "./sandbox-instance-deadline-service.js";

describe("resolveDataPlaneGatewayLifecycleDurations", () => {
  it("returns the default durations when lifecycle config is omitted", () => {
    expect(resolveDataPlaneGatewayLifecycleDurations(undefined)).toEqual(
      DefaultDataPlaneGatewayLifecycleDurations,
    );
  });

  it("returns the configured durations when lifecycle config is provided", () => {
    expect(
      resolveDataPlaneGatewayLifecycleDurations({
        idleTimeoutMs: 20_000,
        bootstrapDisconnectGraceMs: 8_000,
      }),
    ).toEqual({
      idleTimeoutMs: 20_000,
      bootstrapDisconnectGraceMs: 8_000,
    });
  });
});
