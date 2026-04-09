import { TraceFlags, context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  extractTraceContextFromWorkflowRunContext,
  injectActiveTraceContextIntoWorkflowRunContext,
  runWithWorkflowTraceContext,
} from "./workflow-tracing.js";

const ParentSpanContext = {
  traceId: "0123456789abcdef0123456789abcdef",
  spanId: "0123456789abcdef",
  traceFlags: TraceFlags.SAMPLED,
};

const contextManager = new AsyncLocalStorageContextManager();

describe("workflow tracing", () => {
  beforeAll(() => {
    context.setGlobalContextManager(contextManager.enable());
  });

  afterAll(() => {
    contextManager.disable();
  });

  it("injects and extracts the active trace context", () => {
    const workflowRunContext = context.with(
      trace.setSpan(context.active(), trace.wrapSpanContext(ParentSpanContext)),
      () => injectActiveTraceContextIntoWorkflowRunContext(null),
    );
    const extractedContext = extractTraceContextFromWorkflowRunContext(workflowRunContext);
    const extractedSpanContext =
      extractedContext === null ? undefined : trace.getSpanContext(extractedContext);

    expect(extractedSpanContext?.traceId).toBe(ParentSpanContext.traceId);
    expect(extractedSpanContext?.spanId).toBe(ParentSpanContext.spanId);
  });

  it("restores workflow trace context for child workflow scheduling without a recording tracer", async () => {
    const workflowRunContext = context.with(
      trace.setSpan(context.active(), trace.wrapSpanContext(ParentSpanContext)),
      () => injectActiveTraceContextIntoWorkflowRunContext(null),
    );

    const childWorkflowContext = await runWithWorkflowTraceContext({
      fn: () => injectActiveTraceContextIntoWorkflowRunContext(null),
      serviceName: "@mistle/telemetry-test",
      spanName: "workflow-tracing-child",
      workflowRunContext,
      workflowRunId: "workflow_run_test",
      workflowVersion: null,
    });
    const extractedChildContext = extractTraceContextFromWorkflowRunContext(childWorkflowContext);
    const extractedChildSpanContext =
      extractedChildContext === null ? undefined : trace.getSpanContext(extractedChildContext);

    expect(extractedChildSpanContext?.traceId).toBe(ParentSpanContext.traceId);
    expect(extractedChildSpanContext?.spanId).toBe(ParentSpanContext.spanId);
  });
});
