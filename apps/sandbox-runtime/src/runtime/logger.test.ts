import { describe, expect, it } from "vitest";

import { BufferedLogger, formatLogLine } from "./logger.js";

describe("formatLogLine", () => {
  it("serializes a newline-delimited JSON log line", () => {
    expect(
      formatLogLine({
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

describe("BufferedLogger", () => {
  it("replays backlog snapshot lines and then emits live lines until removed", () => {
    const logger = new BufferedLogger();

    logger.logEvent({
      level: "info",
      event: "sandbox_runtime_backlog_line",
    });

    const observedLines: string[] = [];
    const removeListener = logger.addLogLineListener((line) => {
      observedLines.push(line);
    });

    logger.logEvent({
      level: "info",
      event: "sandbox_runtime_log_listener_registered",
    });
    removeListener();
    logger.logEvent({
      level: "info",
      event: "sandbox_runtime_log_listener_removed",
    });

    expect(observedLines).toHaveLength(2);
    expect(observedLines[0]).toContain('"event":"sandbox_runtime_backlog_line"');
    expect(observedLines[1]).toContain('"event":"sandbox_runtime_log_listener_registered"');
  });

  it("drops the oldest buffered lines once the backlog reaches 512 entries", () => {
    const logger = new BufferedLogger();

    for (let index = 0; index < 513; index += 1) {
      logger.logEvent({
        level: "info",
        event: `sandbox_runtime_backlog_${String(index)}`,
      });
    }

    const observedLines: string[] = [];
    const removeListener = logger.addLogLineListener((line) => {
      observedLines.push(line);
    });
    removeListener();

    expect(observedLines).toHaveLength(512);
    expect(observedLines[0]).toContain('"event":"sandbox_runtime_backlog_1"');
    expect(observedLines.at(-1)).toContain('"event":"sandbox_runtime_backlog_512"');
  });
});
