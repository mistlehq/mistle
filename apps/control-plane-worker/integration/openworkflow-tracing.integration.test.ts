import { extractTraceContextFromWorkflowRunContext } from "@mistle/telemetry";
import { TraceFlags, context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { defineWorkflowSpec } from "openworkflow";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { z } from "zod";

import {
  createControlPlaneBackend,
  createControlPlaneOpenWorkflow,
} from "../openworkflow/core/client.js";
import { it } from "./test-context.js";

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

function createActiveTraceContext() {
  return trace.setSpan(context.active(), trace.wrapSpanContext(ParentSpanContext));
}

const contextManager = new AsyncLocalStorageContextManager();

describe("openworkflow tracing integration", () => {
  beforeAll(() => {
    context.setGlobalContextManager(contextManager.enable());
  });

  afterAll(() => {
    contextManager.disable();
  });

  it("persists the active trace context into workflow_runs.context", async ({ fixture }) => {
    const backend = await createControlPlaneBackend({
      url: fixture.databaseStack.directUrl,
      namespaceId: fixture.config.workflow.namespaceId,
      runMigrations: false,
    });
    const openWorkflow = createControlPlaneOpenWorkflow({
      backend,
    });

    try {
      await context.with(createActiveTraceContext(), async () => {
        await openWorkflow.runWorkflow(WorkflowTracingPersistenceSpec, {
          value: "persist-trace-context",
        });
      });

      const workflowRuns = await backend.listWorkflowRuns({
        limit: 10,
      });
      const persistedRun = workflowRuns.data.find(
        (workflowRun) => workflowRun.workflowName === WorkflowTracingPersistenceSpec.name,
      );

      expect(persistedRun).toBeDefined();

      const extractedTraceContext =
        persistedRun === undefined
          ? null
          : extractTraceContextFromWorkflowRunContext(persistedRun.context);
      const extractedSpanContext =
        extractedTraceContext === null ? undefined : trace.getSpanContext(extractedTraceContext);

      expect(extractedSpanContext?.traceId).toBe(ParentSpanContext.traceId);
      expect(extractedSpanContext?.spanId).toBe(ParentSpanContext.spanId);
    } finally {
      await backend.stop();
    }
  }, 60_000);
});
