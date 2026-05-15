import { describe, expect, it } from "vitest";

import {
  formatStartupDisconnectFailureMessage,
  selectStartupFailureEvidenceEvent,
  type StartupFailureEvidenceEvent,
} from "./startup-failure-evidence.js";

const BaseFailureMessage =
  "Sandbox bootstrap tunnel did not recover before disconnect grace expired during startup.";

describe("selectStartupFailureEvidenceEvent", () => {
  it("prioritizes setup script failures over later secondary startup failures", () => {
    const selectedEvent = selectStartupFailureEvidenceEvent([
      createEvent({
        phase: "runtime_processes",
        sequence: 8,
        observedAt: "2026-05-15T08:23:40.000Z",
        createdAt: "2026-05-15T08:23:40.000Z",
        message: "Runtime process failed.",
      }),
      createEvent({
        phase: "setup_script",
        sequence: 5,
        observedAt: "2026-05-15T08:23:35.000Z",
        createdAt: "2026-05-15T08:23:35.000Z",
        message: "Setup script failed.",
      }),
    ]);

    expect(selectedEvent?.phase).toBe("setup_script");
    expect(selectedEvent?.message).toBe("Setup script failed.");
  });

  it("chooses the newest failed event when phases have the same priority", () => {
    const selectedEvent = selectStartupFailureEvidenceEvent([
      createEvent({
        operationId: "op_older",
        sequence: 5,
        observedAt: "2026-05-15T08:23:35.000Z",
        createdAt: "2026-05-15T08:23:35.000Z",
      }),
      createEvent({
        operationId: "op_newer",
        sequence: 3,
        observedAt: "2026-05-15T08:23:45.000Z",
        createdAt: "2026-05-15T08:23:45.000Z",
      }),
    ]);

    expect(selectedEvent?.operationId).toBe("op_newer");
  });

  it("ignores non-failed and transcript events", () => {
    const selectedEvent = selectStartupFailureEvidenceEvent([
      createEvent({
        recordKind: "transcript",
        status: null,
        message: "",
        payloadBytes: Buffer.from("setup output"),
      }),
      createEvent({
        status: "completed",
        message: "Setup script completed.",
      }),
    ]);

    expect(selectedEvent).toBeNull();
  });
});

describe("formatStartupDisconnectFailureMessage", () => {
  it("adds startup evidence to the bootstrap disconnect failure message", () => {
    expect(
      formatStartupDisconnectFailureMessage({
        baseFailureMessage: BaseFailureMessage,
        evidence: {
          phase: "setup_script",
          message: "failed to run setup script",
          detail: 'error: Path "/" is world-writable or a symlink.',
          operationId: "op_setup",
          sequence: 9,
        },
      }),
    ).toBe(
      [
        `${BaseFailureMessage} Last observed startup failure: setup script.`,
        "",
        "Failure: failed to run setup script",
        "",
        'Cause: error: Path "/" is world-writable or a symlink.',
      ].join("\n"),
    );
  });

  it("leaves the base message unchanged when no startup evidence exists", () => {
    expect(
      formatStartupDisconnectFailureMessage({
        baseFailureMessage: BaseFailureMessage,
        evidence: null,
      }),
    ).toBe(BaseFailureMessage);
  });
});

function createEvent(
  input: Partial<StartupFailureEvidenceEvent> = {},
): StartupFailureEvidenceEvent {
  return {
    operationId: input.operationId ?? "op_setup",
    sequence: input.sequence ?? 1,
    recordKind: input.recordKind ?? "lifecycle",
    observedAt: input.observedAt ?? "2026-05-15T08:23:30.000Z",
    createdAt: input.createdAt ?? "2026-05-15T08:23:30.000Z",
    phase: input.phase ?? "setup_script",
    status: input.status ?? "failed",
    stream: input.stream ?? null,
    message: input.message ?? "Setup script failed.",
    payloadBytes: input.payloadBytes ?? null,
    attributes: input.attributes ?? {},
  };
}
