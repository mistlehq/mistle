import {
  integrationConnectionResourceStates,
  IntegrationConnectionResourceSyncStates,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { sql } from "drizzle-orm";

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
    const lockedStateRows = await tx.execute(
      sql<{
        lastSyncStartedAt: string | null;
        syncState: string;
      }>`
        select
          last_sync_started_at as "lastSyncStartedAt",
          sync_state as "syncState"
        from "control_plane"."integration_connection_resource_states"
        where
          connection_id = ${input.connectionId}
          and kind = ${input.kind}
        for update
      `,
    );
    const lockedState = lockedStateRows.rows[0];
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
