import { createManualScheduler, createMutableClock } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import { GatewayForwardingReadiness } from "./gateway-forwarding-readiness.js";
import {
  GatewayForwardingRecoverySupervisor,
  type GatewayForwardingReplacementReason,
} from "./gateway-forwarding-recovery-supervisor.js";

describe("GatewayForwardingRecoverySupervisor", () => {
  it("terminates after three consecutive failed forwarding checks", () => {
    const setup = createSupervisorSetup();
    setup.supervisor.start();

    setup.readiness.markNotReady({ reason: "self_check_failed" });
    setup.readiness.markNotReady({ reason: "self_check_failed" });
    expect(setup.terminationReasons).toEqual([]);

    setup.readiness.markNotReady({ reason: "self_check_failed" });

    expect(setup.terminationReasons).toEqual(["forwarding_check_failure_threshold"]);
  });

  it("terminates when forwarding stays not ready for the replacement delay", () => {
    const setup = createSupervisorSetup();
    setup.supervisor.start();

    setup.clock.advanceMs(89_999);
    setup.scheduler.runDue();
    expect(setup.terminationReasons).toEqual([]);

    setup.clock.advanceMs(1);
    setup.scheduler.runDue();

    expect(setup.terminationReasons).toEqual(["forwarding_not_ready_timeout"]);
  });

  it("does not terminate for not ready forwarding while the gateway is draining", () => {
    const setup = createSupervisorSetup({ draining: true });
    setup.supervisor.start();

    setup.readiness.markNotReady({ reason: "self_check_failed" });
    setup.readiness.markNotReady({ reason: "self_check_failed" });
    setup.readiness.markNotReady({ reason: "self_check_failed" });
    setup.clock.advanceMs(90_000);
    setup.scheduler.runDue();

    expect(setup.terminationReasons).toEqual([]);
  });
});

function createSupervisorSetup(input: { draining?: boolean } = {}): {
  clock: ReturnType<typeof createMutableClock>;
  readiness: GatewayForwardingReadiness;
  scheduler: ReturnType<typeof createManualScheduler>;
  supervisor: GatewayForwardingRecoverySupervisor;
  terminationReasons: GatewayForwardingReplacementReason[];
} {
  const clock = createMutableClock(1_000);
  const scheduler = createManualScheduler(clock);
  const terminationReasons: GatewayForwardingReplacementReason[] = [];
  const readiness = new GatewayForwardingReadiness({
    backend: "nats",
    clock,
    localNodeId: "gateway-a",
    subject: "mistle.gateway.forward.gateway-a",
  });
  const supervisor = new GatewayForwardingRecoverySupervisor({
    clock,
    isDraining: () => input.draining === true,
    localNodeId: "gateway-a",
    readiness,
    scheduler,
    terminate: (reason) => {
      terminationReasons.push(reason);
    },
  });

  return {
    clock,
    readiness,
    scheduler,
    supervisor,
    terminationReasons,
  };
}
