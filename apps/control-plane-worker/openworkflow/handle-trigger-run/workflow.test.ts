import { describe, expect, test } from "vitest";

import {
  DurableHandleTriggerRunStepNames,
  normalizeHandleTriggerRunWorkflowInput,
} from "./workflow.js";

describe("handle trigger run workflow input", () => {
  test("accepts the canonical trigger run id field", () => {
    expect(normalizeHandleTriggerRunWorkflowInput({ triggerRunId: "trn_123" })).toEqual({
      triggerRunId: "trn_123",
    });
  });

  test("accepts the durable v1 automation run id field", () => {
    expect(normalizeHandleTriggerRunWorkflowInput({ automationRunId: "aru_123" })).toEqual({
      triggerRunId: "aru_123",
    });
  });

  test("rejects ambiguous trigger run id inputs", () => {
    expect(() =>
      normalizeHandleTriggerRunWorkflowInput({
        triggerRunId: "trn_123",
        automationRunId: "aru_123",
      }),
    ).toThrow(/exactly one trigger run id/);
  });

  test("rejects missing trigger run id inputs", () => {
    expect(() => normalizeHandleTriggerRunWorkflowInput({})).toThrow(/exactly one trigger run id/);
  });

  test("keeps durable v1 step names stable", () => {
    expect(DurableHandleTriggerRunStepNames).toEqual({
      TRANSITION_TO_RUNNING: "transition-automation-run-to-running",
      PREPARE_RUN: "prepare-automation-run",
      HANDOFF_DELIVERY: "handoff-automation-run-delivery",
      MARK_FAILED: "mark-automation-run-failed",
    });
  });
});
