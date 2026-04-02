import { describe, expect, it } from "vitest";

import { TelemetryLogBuffer } from "./telemetry-log-buffer.js";

describe("TelemetryLogBuffer", () => {
  it("buffers log lines and drains only lines that fit the current window", () => {
    const buffer = new TelemetryLogBuffer(8);
    buffer.resetWindow(4);

    expect(buffer.enqueue(new TextEncoder().encode("1234"))).toEqual({
      kind: "accepted",
    });
    expect(buffer.enqueue(new TextEncoder().encode("56"))).toEqual({
      kind: "accepted",
    });

    expect(buffer.drainSendableLines().map((line) => Buffer.from(line).toString("utf8"))).toEqual([
      "1234",
    ]);

    buffer.addWindow(4);

    expect(buffer.drainSendableLines().map((line) => Buffer.from(line).toString("utf8"))).toEqual([
      "56",
    ]);
  });

  it("drops oversized log lines and emits at most one warning until the buffer drains", () => {
    const buffer = new TelemetryLogBuffer(4);

    expect(buffer.enqueue(new TextEncoder().encode("12345"))).toEqual({
      kind: "dropped",
      droppedBytes: 5,
      emitWarning: true,
    });
    expect(buffer.enqueue(new TextEncoder().encode("67890"))).toEqual({
      kind: "dropped",
      droppedBytes: 5,
      emitWarning: false,
    });

    buffer.resetWindow(4);
    buffer.enqueue(new TextEncoder().encode("1234"));
    expect(buffer.drainSendableLines()).toHaveLength(1);

    expect(buffer.enqueue(new TextEncoder().encode("67890"))).toEqual({
      kind: "dropped",
      droppedBytes: 5,
      emitWarning: true,
    });
  });
});
