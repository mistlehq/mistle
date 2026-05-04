import {
  IntegrationConnectionResourceSyncStates,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { sql } from "drizzle-orm";

export async function markResourceSyncing(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  familyId: string;
  kind: string;
}): Promise<string> {
  const tables = getControlPlaneDatabaseSchema(input.db);

  const updatedStates = await input.db
    .insert(tables.integrationConnectionResourceStates)
    .values({
      connectionId: input.connectionId,
      familyId: input.familyId,
      kind: input.kind,
      syncState: IntegrationConnectionResourceSyncStates.SYNCING,
      lastSyncStartedAt: sql`now()`,
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [
        tables.integrationConnectionResourceStates.connectionId,
        tables.integrationConnectionResourceStates.kind,
      ],
      set: {
        familyId: input.familyId,
        syncState: IntegrationConnectionResourceSyncStates.SYNCING,
        lastSyncStartedAt: sql`now()`,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: sql`now()`,
      },
    })
    .returning({
      lastSyncStartedAt: tables.integrationConnectionResourceStates.lastSyncStartedAt,
    });

  const updatedState = updatedStates[0];
  if (updatedState === undefined || updatedState.lastSyncStartedAt === null) {
    throw new Error("Expected resource sync start to persist a start timestamp.");
  }

  return updatedState.lastSyncStartedAt;
}
