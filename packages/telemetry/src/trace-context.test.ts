import { TraceFlags, context, createTraceState, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { extractActiveW3cTraceCarrier } from "./trace-context.js";

const ParentSpanContext = {
  traceId: "0123456789abcdef0123456789abcdef",
  spanId: "0123456789abcdef",
  traceFlags: TraceFlags.SAMPLED,
};

const contextManager = new AsyncLocalStorageContextManager();

describe("extractActiveW3cTraceCarrier", () => {
  beforeAll(() => {
    context.setGlobalContextManager(contextManager.enable());
  });

  afterAll(() => {
    contextManager.disable();
  });

  it("returns the active traceparent when a span context is present", () => {
    const carrier = context.with(
      trace.setSpan(context.active(), trace.wrapSpanContext(ParentSpanContext)),
      () => extractActiveW3cTraceCarrier(),
    );

    expect(carrier).toEqual({
      traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    });
  });

  it("preserves tracestate and baggage when they are present on the active context", () => {
    const carrier = context.with(
      propagation.setBaggage(
        trace.setSpan(
          context.active(),
          trace.wrapSpanContext({
            ...ParentSpanContext,
            traceState: createTraceState("vendor=value"),
          }),
        ),
        propagation.createBaggage({
          trigger: {
            value: "webhook",
          },
        }),
      ),
      () => extractActiveW3cTraceCarrier(),
    );

    expect(carrier).toEqual({
      traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
      tracestate: "vendor=value",
      baggage: "trigger=webhook",
    });
  });

  it("returns null when no active span context exists", () => {
    expect(extractActiveW3cTraceCarrier()).toBeNull();
  });
});
