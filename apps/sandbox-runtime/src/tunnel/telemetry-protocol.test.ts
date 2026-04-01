import { describe, expect, it } from "vitest";

import { parseBootstrapTelemetryControlMessage } from "./telemetry-protocol.js";

describe("parseBootstrapTelemetryControlMessage", () => {
  it("accepts gateway-to-bootstrap telemetry control messages", () => {
    expect(
      parseBootstrapTelemetryControlMessage(
        JSON.stringify({
          type: "telemetry.open.ok",
          streamId: 7,
          initialWindowBytes: 65536,
        }),
      ),
    ).toEqual({
      type: "telemetry.open.ok",
      streamId: 7,
      initialWindowBytes: 65536,
    });

    expect(
      parseBootstrapTelemetryControlMessage(
        JSON.stringify({
          type: "telemetry.reset",
          streamId: 7,
          code: "telemetry_stream_not_found",
          message: "stream not found",
        }),
      ),
    ).toEqual({
      type: "telemetry.reset",
      streamId: 7,
      code: "telemetry_stream_not_found",
      message: "stream not found",
    });
  });

  it("rejects sandbox-originated telemetry control messages", () => {
    expect(
      parseBootstrapTelemetryControlMessage(
        JSON.stringify({
          type: "telemetry.open",
          streamId: 7,
          signal: "logs",
          format: "mistle.sandbox-runtime.log.v1",
        }),
      ),
    ).toBeUndefined();
  });
});
