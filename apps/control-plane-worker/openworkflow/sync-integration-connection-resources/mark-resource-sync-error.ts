import {
  IntegrationConnectionResourceSyncStates,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
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
    const tables = getControlPlaneDatabaseSchema(tx);

    const [lockedState] = await tx
      .select({
        lastSyncStartedAt: tables.integrationConnectionResourceStates.lastSyncStartedAt,
        syncState: tables.integrationConnectionResourceStates.syncState,
      })
      .from(tables.integrationConnectionResourceStates)
      .where(
        and(
          eq(tables.integrationConnectionResourceStates.connectionId, input.connectionId),
          eq(tables.integrationConnectionResourceStates.kind, input.kind),
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
      .update(tables.integrationConnectionResourceStates)
      .set({
        familyId: input.familyId,
        syncState: IntegrationConnectionResourceSyncStates.ERROR,
        lastSyncFinishedAt: sql`now()`,
        lastErrorCode: input.failure.code,
        lastErrorMessage: input.failure.message,
        updatedAt: sql`now()`,
      })
      .where(
        sql`${tables.integrationConnectionResourceStates.connectionId} = ${input.connectionId} and ${tables.integrationConnectionResourceStates.kind} = ${input.kind}`,
      );

    return true;
  });
}
