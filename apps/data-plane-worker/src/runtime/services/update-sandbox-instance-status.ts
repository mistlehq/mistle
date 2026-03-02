import {
  SandboxInstanceStatuses,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import { and, eq, sql } from "drizzle-orm";

import type { MarkSandboxInstanceFailedInput, MarkSandboxInstanceRunningInput } from "./types.js";

export async function markSandboxInstanceRunning(
  deps: {
    db: DataPlaneDatabase;
  },
  input: MarkSandboxInstanceRunningInput,
): Promise<void> {
  const updatedRows = await deps.db
    .update(sandboxInstances)
    .set({
      status: SandboxInstanceStatuses.RUNNING,
      startedAt: sql`now()`,
      failedAt: null,
      failureCode: null,
      failureMessage: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sandboxInstances.id, input.sandboxInstanceId),
        eq(sandboxInstances.status, SandboxInstanceStatuses.STARTING),
      ),
    )
    .returning({
      id: sandboxInstances.id,
    });

  if (updatedRows[0] === undefined) {
    throw new Error("Failed to transition sandbox instance status from starting to running.");
  }
}

export async function markSandboxInstanceFailed(
  deps: {
    db: DataPlaneDatabase;
  },
  input: MarkSandboxInstanceFailedInput,
): Promise<void> {
  const updatedRows = await deps.db
    .update(sandboxInstances)
    .set({
      status: SandboxInstanceStatuses.FAILED,
      failedAt: sql`now()`,
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sandboxInstances.id, input.sandboxInstanceId),
        eq(sandboxInstances.status, SandboxInstanceStatuses.STARTING),
      ),
    )
    .returning({
      id: sandboxInstances.id,
    });

  if (updatedRows[0] === undefined) {
    throw new Error("Failed to transition sandbox instance status from starting to failed.");
  }
}
