import { sandboxExecutionLeases, type DataPlaneDatabase } from "@mistle/db/data-plane";
import type { ExecutionLease } from "@mistle/sandbox-session-protocol";
import { and, eq, sql } from "drizzle-orm";

export class SandboxExecutionLeaseNotFoundError extends Error {
  public constructor(input: { leaseId: string; sandboxInstanceId: string }) {
    super(
      `Execution lease '${input.leaseId}' was not found for sandbox '${input.sandboxInstanceId}'.`,
    );
    this.name = "SandboxExecutionLeaseNotFoundError";
  }
}

export async function createSandboxExecutionLease(input: {
  db: DataPlaneDatabase;
  lease: ExecutionLease;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.db
    .insert(sandboxExecutionLeases)
    .values({
      id: input.lease.id,
      sandboxInstanceId: input.sandboxInstanceId,
      kind: input.lease.kind,
      source: input.lease.source,
      externalExecutionId: input.lease.externalExecutionId ?? null,
      metadata: input.lease.metadata ?? null,
    })
    .onConflictDoUpdate({
      target: sandboxExecutionLeases.id,
      set: {
        lastSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      },
    });
}

export async function renewSandboxExecutionLease(input: {
  db: DataPlaneDatabase;
  leaseId: string;
  sandboxInstanceId: string;
}): Promise<void> {
  const updatedRows = await input.db
    .update(sandboxExecutionLeases)
    .set({
      lastSeenAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sandboxExecutionLeases.id, input.leaseId),
        eq(sandboxExecutionLeases.sandboxInstanceId, input.sandboxInstanceId),
      ),
    )
    .returning({
      id: sandboxExecutionLeases.id,
    });

  if (updatedRows[0] !== undefined) {
    return;
  }

  throw new SandboxExecutionLeaseNotFoundError({
    leaseId: input.leaseId,
    sandboxInstanceId: input.sandboxInstanceId,
  });
}
