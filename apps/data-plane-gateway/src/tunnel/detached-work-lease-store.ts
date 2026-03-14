import { sandboxDetachedWorkLeases, type DataPlaneDatabase } from "@mistle/db/data-plane";
import type { DetachedWorkLeaseControlMessage } from "@mistle/sandbox-session-protocol";
import { sql } from "drizzle-orm";

export async function recordDetachedWorkLeaseObservation(input: {
  db: DataPlaneDatabase;
  message: DetachedWorkLeaseControlMessage;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.db
    .insert(sandboxDetachedWorkLeases)
    .values({
      leaseId: input.message.leaseId,
      sandboxInstanceId: input.sandboxInstanceId,
      kind: input.message.kind,
      protocolFamily: input.message.protocolFamily,
      externalExecutionId: input.message.externalExecutionId ?? null,
      openedAt: sql`now()`,
      lastSeenAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: sandboxDetachedWorkLeases.leaseId,
      set: {
        sandboxInstanceId: input.sandboxInstanceId,
        kind: input.message.kind,
        protocolFamily: input.message.protocolFamily,
        externalExecutionId: sql`coalesce(excluded.external_execution_id, ${sandboxDetachedWorkLeases.externalExecutionId})`,
        lastSeenAt: sql`now()`,
      },
    });
}
