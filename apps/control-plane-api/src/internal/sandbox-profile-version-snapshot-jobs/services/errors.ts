import { ConflictError, NotFoundError } from "@mistle/http/errors.js";

export function createSnapshotJobNotFoundError(snapshotJobId: string): NotFoundError {
  return new NotFoundError(
    "SNAPSHOT_JOB_NOT_FOUND",
    `Snapshot job '${snapshotJobId}' was not found.`,
  );
}

export function createSnapshotJobStateConflictError(input: {
  snapshotJobId: string;
  actualState: string;
  message: string;
}): ConflictError {
  return new ConflictError(
    "SNAPSHOT_JOB_STATE_CONFLICT",
    `${input.message} Snapshot job '${input.snapshotJobId}' is '${input.actualState}'.`,
  );
}

export function createSnapshotJobOwnershipMismatchError(input: {
  snapshotJobId: string;
  workflowRunId: string | null;
}): ConflictError {
  return new ConflictError(
    "SNAPSHOT_JOB_OWNERSHIP_MISMATCH",
    `Snapshot job '${input.snapshotJobId}' is owned by workflow '${input.workflowRunId ?? "unknown"}'.`,
  );
}
