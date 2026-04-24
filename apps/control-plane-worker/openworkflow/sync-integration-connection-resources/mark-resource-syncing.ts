import {
  integrationConnectionResourceStates,
  IntegrationConnectionResourceSyncStates,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { sql } from "drizzle-orm";

export async function markResourceSyncing(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  familyId: string;
  kind: string;
}): Promise<string> {
  const updatedStates = await input.db
    .insert(integrationConnectionResourceStates)
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
        integrationConnectionResourceStates.connectionId,
        integrationConnectionResourceStates.kind,
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
      lastSyncStartedAt: integrationConnectionResourceStates.lastSyncStartedAt,
    });

  const updatedState = updatedStates[0];
  if (updatedState === undefined || updatedState.lastSyncStartedAt === null) {
    throw new Error("Expected resource sync start to persist a start timestamp.");
  }

  return updatedState.lastSyncStartedAt;
}
