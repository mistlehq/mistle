import { describe, expect, it } from "vitest";

import { BootstrapTelemetrySession } from "./bootstrap-telemetry-session.js";

describe("BootstrapTelemetrySession", () => {
  it("opens one telemetry stream per signal and returns the initial window", () => {
    const session = new BootstrapTelemetrySession(128);

    expect(
      session.openStream({
        format: "mistle.sandbox-runtime.log.v1",
        signal: "logs",
        streamId: 41,
      }),
    ).toEqual({
      kind: "ok",
      response: {
        type: "telemetry.open.ok",
        streamId: 41,
        initialWindowBytes: 128,
      },
      stream: {
        format: "mistle.sandbox-runtime.log.v1",
        remainingWindowBytes: 128,
        signal: "logs",
        streamId: 41,
      },
    });
  });

  it("rejects opening the same stream id twice", () => {
    const session = new BootstrapTelemetrySession(128);
    session.openStream({
      format: "mistle.sandbox-runtime.log.v1",
      signal: "logs",
      streamId: 41,
    });

    expect(
      session.openStream({
        format: "mistle.sandbox-runtime.log.v1",
        signal: "logs",
        streamId: 41,
      }),
    ).toEqual({
      kind: "error",
      response: {
        type: "telemetry.open.error",
        streamId: 41,
        code: "telemetry_stream_already_open",
        message: "Telemetry stream 41 is already open.",
      },
    });
  });

  it("rejects opening the same signal on a different stream", () => {
    const session = new BootstrapTelemetrySession(128);
    session.openStream({
      format: "mistle.sandbox-runtime.log.v1",
      signal: "logs",
      streamId: 41,
    });

    expect(
      session.openStream({
        format: "mistle.sandbox-runtime.log.v1",
        signal: "logs",
        streamId: 42,
      }),
    ).toEqual({
      kind: "error",
      response: {
        type: "telemetry.open.error",
        streamId: 42,
        code: "telemetry_signal_already_open",
        message: "Telemetry signal 'logs' is already open on stream 41.",
      },
    });
  });

  it("tracks receive-window consumption and replenishment", () => {
    const session = new BootstrapTelemetrySession(64);
    session.openStream({
      format: "mistle.sandbox-runtime.log.v1",
      signal: "logs",
      streamId: 41,
    });

    expect(
      session.consumeWindow({
        payloadByteLength: 20,
        streamId: 41,
      }),
    ).toEqual({
      kind: "ok",
      stream: {
        format: "mistle.sandbox-runtime.log.v1",
        remainingWindowBytes: 44,
        signal: "logs",
        streamId: 41,
      },
    });
    expect(
      session.restoreWindow({
        bytes: 20,
        streamId: 41,
      }),
    ).toEqual({
      type: "telemetry.window",
      streamId: 41,
      bytes: 20,
    });
    expect(
      session.consumeWindow({
        payloadByteLength: 64,
        streamId: 41,
      }),
    ).toEqual({
      kind: "ok",
      stream: {
        format: "mistle.sandbox-runtime.log.v1",
        remainingWindowBytes: 0,
        signal: "logs",
        streamId: 41,
      },
    });
  });

  it("resets and closes the stream when the receive window is exceeded", () => {
    const session = new BootstrapTelemetrySession(16);
    session.openStream({
      format: "mistle.sandbox-runtime.log.v1",
      signal: "logs",
      streamId: 41,
    });

    expect(
      session.consumeWindow({
        payloadByteLength: 17,
        streamId: 41,
      }),
    ).toEqual({
      kind: "reset",
      response: {
        type: "telemetry.reset",
        streamId: 41,
        code: "telemetry_window_exhausted",
        message: "Telemetry stream 41 exhausted its receive window.",
      },
      stream: {
        format: "mistle.sandbox-runtime.log.v1",
        remainingWindowBytes: 16,
        signal: "logs",
        streamId: 41,
      },
    });
    expect(session.streamCount).toBe(0);
  });

  it("resets invalid payload kinds and closes the stream", () => {
    const session = new BootstrapTelemetrySession(16);
    session.openStream({
      format: "mistle.sandbox-runtime.log.v1",
      signal: "logs",
      streamId: 41,
    });

    expect(
      session.invalidateStream({
        payloadKind: 2,
        streamId: 41,
      }),
    ).toEqual({
      response: {
        type: "telemetry.reset",
        streamId: 41,
        code: "invalid_telemetry_data",
        message: "Telemetry stream 41 only accepts raw-bytes frames, received payload kind 2.",
      },
      stream: {
        format: "mistle.sandbox-runtime.log.v1",
        remainingWindowBytes: 16,
        signal: "logs",
        streamId: 41,
      },
    });
    expect(session.streamCount).toBe(0);
  });

  it("resets unknown streams on data delivery", () => {
    const session = new BootstrapTelemetrySession(16);

    expect(
      session.consumeWindow({
        payloadByteLength: 1,
        streamId: 41,
      }),
    ).toEqual({
      kind: "reset",
      response: {
        type: "telemetry.reset",
        streamId: 41,
        code: "telemetry_stream_not_found",
        message: "Telemetry stream 41 is not open on this bootstrap session.",
      },
      stream: undefined,
    });
  });
});
