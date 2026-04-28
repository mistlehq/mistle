import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createScheduledActionDispatchStepName } from "./batch-workflow.js";
import {
  createScheduleDispatchBatchIdempotencyKey,
  partitionScheduledActionIds,
} from "./batches.js";

function expectedBatchKey(actionIds: readonly string[]): string {
  const hash = createHash("sha256")
    .update([...actionIds].sort().join("\n"))
    .digest("hex");
  return `schedule-dispatch-batch:${hash}`;
}

describe("schedule dispatch batches", () => {
  it("sorts action ids before partitioning into fixed-size child batches", () => {
    expect(
      partitionScheduledActionIds({
        scheduledActionIds: ["sca_004", "sca_001", "sca_003", "sca_002", "sca_005"],
        batchSize: 2,
      }),
    ).toEqual([["sca_001", "sca_002"], ["sca_003", "sca_004"], ["sca_005"]]);
  });

  it("derives the child workflow idempotency key from the full sorted batch contents", () => {
    expect(createScheduleDispatchBatchIdempotencyKey(["sca_b", "sca_a", "sca_c"])).toBe(
      expectedBatchKey(["sca_a", "sca_b", "sca_c"]),
    );
  });

  it("derives stable per-action dispatch step names from scheduled action ids", () => {
    expect(createScheduledActionDispatchStepName("sca_001")).toBe(
      "dispatch-scheduled-action:sca_001",
    );
  });

  it("rejects empty batches and invalid batch sizes", () => {
    expect(() => createScheduleDispatchBatchIdempotencyKey([])).toThrow(
      "Expected at least one scheduled action id for schedule dispatch batch.",
    );
    expect(() =>
      partitionScheduledActionIds({
        scheduledActionIds: ["sca_001"],
        batchSize: 0,
      }),
    ).toThrow("Expected schedule dispatch batch size to be a positive integer.");
  });
});
