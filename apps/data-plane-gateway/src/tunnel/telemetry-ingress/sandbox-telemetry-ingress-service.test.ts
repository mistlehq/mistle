import { describe, expect, it } from "vitest";

import { SandboxTelemetryIngressService } from "./sandbox-telemetry-ingress-service.js";
import { UnimplementedSandboxTelemetryIngressSink } from "./unimplemented-sandbox-telemetry-ingress-sink.js";

describe("SandboxTelemetryIngressService", () => {
  it("returns telemetry.open.error when the gateway sink is not configured", async () => {
    const service = new SandboxTelemetryIngressService(
      new UnimplementedSandboxTelemetryIngressSink(),
    );
    const sentMessages: unknown[] = [];

    await service.handleDelivery({
      delivery: {
        kind: "telemetryOpen",
        message: {
          type: "telemetry.open",
          streamId: 41,
          signal: "logs",
          format: "mistle.sandbox-runtime.log.v1",
        },
      },
      relaySessionId: "sess_bootstrap",
      sandboxInstanceId: "sbi_test",
      sendControlMessage: (message) => {
        sentMessages.push(message);
      },
    });

    expect(sentMessages).toEqual([
      {
        type: "telemetry.open.error",
        streamId: 41,
        code: "telemetry_sink_open_failed",
        message: "Sandbox telemetry sink is not configured on this gateway.",
      },
    ]);
  });

  it("resets data frames for telemetry streams that are not attached", async () => {
    const service = new SandboxTelemetryIngressService(
      new UnimplementedSandboxTelemetryIngressSink(),
    );
    const sentMessages: unknown[] = [];

    await service.handleDelivery({
      delivery: {
        kind: "telemetryData",
        streamId: 41,
        payload: new Uint8Array([1, 2, 3]).buffer,
      },
      relaySessionId: "sess_bootstrap",
      sandboxInstanceId: "sbi_test",
      sendControlMessage: (message) => {
        sentMessages.push(message);
      },
    });

    expect(sentMessages).toEqual([
      {
        type: "telemetry.reset",
        streamId: 41,
        code: "telemetry_stream_not_found",
        message: "Telemetry stream 41 is not open on this bootstrap session.",
      },
    ]);
  });
});
