import { describe, expect, it } from "vitest";

import { SandboxTelemetryLogLineDecoder } from "./sandbox-telemetry-log-line-decoder.js";

describe("SandboxTelemetryLogLineDecoder", () => {
  it("reassembles newline-delimited UTF-8 log lines across frame boundaries", () => {
    const decoder = new SandboxTelemetryLogLineDecoder();

    expect(decoder.append(Buffer.from('{"timestamp":"2026-04-02T09:00:00.000Z"', "utf8"))).toEqual(
      [],
    );
    expect(
      decoder.append(Buffer.from(',"level":"info","event":"sandbox_ready"}\n\n', "utf8")),
    ).toEqual(['{"timestamp":"2026-04-02T09:00:00.000Z","level":"info","event":"sandbox_ready"}']);
  });

  it("resets invalid UTF-8 log lines", () => {
    const decoder = new SandboxTelemetryLogLineDecoder();

    expect(() => decoder.append(new Uint8Array([0xc3, 0x28, 0x0a]))).toThrow(
      "Telemetry log line does not match mistle.sandbox-runtime.log.v1.",
    );
  });

  it("resets unterminated buffered log lines on close", () => {
    const decoder = new SandboxTelemetryLogLineDecoder();

    decoder.append(Buffer.from('{"timestamp":"2026-04-02T09:00:00.000Z"', "utf8"));

    expect(() => decoder.finalize()).toThrow(
      "Telemetry stream closed with an incomplete log line.",
    );
  });
});
