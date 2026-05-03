/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { extractTraceContextFromWorkflowRunContext } from "@mistle/telemetry";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { TraceFlags, context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { defineWorkflowSpec } from "openworkflow";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { z } from "zod";

const it = createIntegrationTest({
  services: ["control-plane-worker"],
});

const ParentSpanContext = {
  traceId: "0123456789abcdef0123456789abcdef",
  spanId: "0123456789abcdef",
  traceFlags: TraceFlags.SAMPLED,
};

const WorkflowTracingPersistenceSpec = defineWorkflowSpec({
  name: "workflow-tracing-persistence-test",
  schema: z
    .object({
      value: z.string().min(1),
    })
    .strict(),
});

const contextManager = new AsyncLocalStorageContextManager();

describe("control-plane OpenWorkflow tracing", () => {
  beforeAll(() => {
    context.setGlobalContextManager(contextManager.enable());
  });

  afterAll(() => {
    contextManager.disable();
  });

  it("persists the active trace context into workflow run context", async ({ env }) => {
    const handle = await context.with(createActiveTraceContext(), async () =>
      env.controlPlaneWorkflow.runWorkflow(WorkflowTracingPersistenceSpec, {
        value: "persist-trace-context",
      }),
    );

    const extractedTraceContext = extractTraceContextFromWorkflowRunContext(
      handle.workflowRun.context,
    );
    const extractedSpanContext =
      extractedTraceContext === null ? undefined : trace.getSpanContext(extractedTraceContext);

    expect(extractedSpanContext?.traceId).toBe(ParentSpanContext.traceId);
    expect(extractedSpanContext?.spanId).toBe(ParentSpanContext.spanId);
  });
});

function createActiveTraceContext() {
  return trace.setSpan(context.active(), trace.wrapSpanContext(ParentSpanContext));
}
