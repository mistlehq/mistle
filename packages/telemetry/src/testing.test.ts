import { trace } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";

import { installInMemoryTracing } from "./testing.js";

const TestTracer = trace.getTracer("@mistle/telemetry/testing.test");

describe("installInMemoryTracing", () => {
  it("captures finished spans and resets them", async () => {
    const tracing = installInMemoryTracing();
    tracing.reset();

    await TestTracer.startActiveSpan("telemetry.testing.span", async (span) => {
      span.end();
    });
    await tracing.forceFlush();

    expect(tracing.getFinishedSpans().map((span) => span.name)).toContain("telemetry.testing.span");

    tracing.reset();
    expect(tracing.getFinishedSpans()).toHaveLength(0);
  });
});
