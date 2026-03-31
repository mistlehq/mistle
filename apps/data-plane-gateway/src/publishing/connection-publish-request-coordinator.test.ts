import { createManualScheduler, createMutableClock } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import {
  ConnectionPublishRequestCoordinator,
  DuplicateConnectionPublishRequestIdError,
} from "./connection-publish-request-coordinator.js";

describe("ConnectionPublishRequestCoordinator", () => {
  it("rejects duplicate request ids within one connection session", () => {
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    const coordinator = new ConnectionPublishRequestCoordinator(scheduler, 5_000);

    coordinator.beginRequest({
      clientRequestId: "req_1",
      clientSessionId: "session_1",
    });

    expect(() =>
      coordinator.beginRequest({
        clientRequestId: "req_1",
        clientSessionId: "session_1",
      }),
    ).toThrow(new DuplicateConnectionPublishRequestIdError("session_1", "req_1").message);
  });

  it("releases pending requests when the connection session closes", () => {
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    const coordinator = new ConnectionPublishRequestCoordinator(scheduler, 5_000);

    const startedRequest = coordinator.beginRequest({
      clientRequestId: "req_1",
      clientSessionId: "session_1",
    });

    coordinator.releaseClientSession({
      clientSessionId: "session_1",
    });

    expect(
      coordinator.resolveRequest({
        bootstrapRequestId: startedRequest.bootstrapRequestId,
      }),
    ).toBeUndefined();
  });

  it("expires pending requests after the configured timeout", () => {
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    const coordinator = new ConnectionPublishRequestCoordinator(scheduler, 5_000);

    const startedRequest = coordinator.beginRequest({
      clientRequestId: "req_1",
      clientSessionId: "session_1",
    });

    clock.advanceMs(5_000);
    scheduler.runDue();

    expect(
      coordinator.resolveRequest({
        bootstrapRequestId: startedRequest.bootstrapRequestId,
      }),
    ).toBeUndefined();
  });
});
