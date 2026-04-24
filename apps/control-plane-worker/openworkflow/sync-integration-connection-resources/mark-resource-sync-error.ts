import {
  integrationConnectionResourceStates,
  IntegrationConnectionResourceSyncStates,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

export async function markResourceSyncError(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  familyId: string;
  kind: string;
  syncStartedAt: string;
  failure: {
    code: string;
    message: string;
  };
}): Promise<boolean> {
  return input.db.transaction(async (tx) => {
    const [lockedState] = await tx
      .select({
        lastSyncStartedAt: integrationConnectionResourceStates.lastSyncStartedAt,
        syncState: integrationConnectionResourceStates.syncState,
      })
      .from(integrationConnectionResourceStates)
      .where(
        and(
          eq(integrationConnectionResourceStates.connectionId, input.connectionId),
          eq(integrationConnectionResourceStates.kind, input.kind),
        ),
      )
      .for("update");
    if (
      lockedState === undefined ||
      lockedState.syncState !== IntegrationConnectionResourceSyncStates.SYNCING ||
      lockedState.lastSyncStartedAt !== input.syncStartedAt
    ) {
      return false;
    }

    await tx
      .update(integrationConnectionResourceStates)
      .set({
        familyId: input.familyId,
        syncState: IntegrationConnectionResourceSyncStates.ERROR,
        lastSyncFinishedAt: sql`now()`,
        lastErrorCode: input.failure.code,
        lastErrorMessage: input.failure.message,
        updatedAt: sql`now()`,
      })
      .where(
        sql`${integrationConnectionResourceStates.connectionId} = ${input.connectionId} and ${integrationConnectionResourceStates.kind} = ${input.kind}`,
      );

    return true;
  });
}
