import { describe, expect, it } from "vitest";

import {
  addSandboxRuntimeLogLineListener,
  formatSandboxRuntimeLogLine,
  logSandboxRuntimeEvent,
} from "./logger.js";

describe("formatSandboxRuntimeLogLine", () => {
  it("serializes a newline-delimited JSON log line", () => {
    expect(
      formatSandboxRuntimeLogLine({
        timestamp: new Date("2026-03-23T08:00:00.000Z"),
        level: "info",
        event: "sandbox_runtime_startup_ready",
        fields: {
          artifactCount: 1,
          runtimeClientCount: 2,
          startupReady: true,
          reason: null,
        },
      }),
    ).toBe(
      '{"timestamp":"2026-03-23T08:00:00.000Z","level":"info","event":"sandbox_runtime_startup_ready","artifactCount":1,"runtimeClientCount":2,"startupReady":true,"reason":null}\n',
    );
  });
});

describe("addSandboxRuntimeLogLineListener", () => {
  it("registers and removes listeners", () => {
    const observedLines: string[] = [];
    const removeListener = addSandboxRuntimeLogLineListener((line) => {
      observedLines.push(line);
    });

    logSandboxRuntimeEvent({
      level: "info",
      event: "sandbox_runtime_log_listener_registered",
    });
    removeListener();
    logSandboxRuntimeEvent({
      level: "info",
      event: "sandbox_runtime_log_listener_removed",
    });

    expect(observedLines).toHaveLength(1);
    expect(observedLines[0]).toContain('"event":"sandbox_runtime_log_listener_registered"');
  });
});
