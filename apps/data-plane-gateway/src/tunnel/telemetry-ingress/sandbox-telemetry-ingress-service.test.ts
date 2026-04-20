import { DefaultStreamWindowBytes } from "@mistle/sandbox-session-protocol";
import { describe, expect, it } from "vitest";

import { NoopSandboxTelemetryIngressSink } from "./noop-sandbox-telemetry-ingress-sink.js";
import { SandboxTelemetryIngressService } from "./sandbox-telemetry-ingress-service.js";

describe("SandboxTelemetryIngressService", () => {
  it("accepts telemetry.open with the local no-op sink", async () => {
    const service = new SandboxTelemetryIngressService(new NoopSandboxTelemetryIngressSink());
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
        type: "telemetry.open.ok",
        streamId: 41,
        initialWindowBytes: DefaultStreamWindowBytes,
      },
    ]);
  });

  it("accepts trace telemetry.open with the local no-op sink", async () => {
    const service = new SandboxTelemetryIngressService(new NoopSandboxTelemetryIngressSink());
    const sentMessages: unknown[] = [];

    await service.handleDelivery({
      delivery: {
        kind: "telemetryOpen",
        message: {
          type: "telemetry.open",
          streamId: 42,
          signal: "traces",
          format: "otlp.http.traces.v1+json",
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
        type: "telemetry.open.ok",
        streamId: 42,
        initialWindowBytes: DefaultStreamWindowBytes,
      },
    ]);
  });

  it("resets data frames for telemetry streams that are not attached", async () => {
    const service = new SandboxTelemetryIngressService(new NoopSandboxTelemetryIngressSink());
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
