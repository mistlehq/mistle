import { createHash } from "node:crypto";

export const ScheduleDispatchChildBatchSize = 100;
export const ScheduleDispatchChildConcurrency = 10;
export const StaleScheduleDispatchAfterMs = 15 * 60 * 1000;

export function partitionScheduledActionIds(input: {
  scheduledActionIds: readonly string[];
  batchSize: number;
}): string[][] {
  if (!Number.isInteger(input.batchSize) || input.batchSize <= 0) {
    throw new Error("Expected schedule dispatch batch size to be a positive integer.");
  }

  const sortedActionIds = [...input.scheduledActionIds].sort();
  const batches: string[][] = [];
  for (let index = 0; index < sortedActionIds.length; index += input.batchSize) {
    batches.push(sortedActionIds.slice(index, index + input.batchSize));
  }

  return batches;
}

export function createScheduleDispatchBatchIdempotencyKey(
  scheduledActionIds: readonly string[],
): string {
  if (scheduledActionIds.length === 0) {
    throw new Error("Expected at least one scheduled action id for schedule dispatch batch.");
  }

  const hash = createHash("sha256")
    .update([...scheduledActionIds].sort().join("\n"))
    .digest("hex");
  return `schedule-dispatch-batch:${hash}`;
}
