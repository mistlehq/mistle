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
  failure: {
    code: string;
    message: string;
  };
}): Promise<void> {
  await input.db
    .insert(integrationConnectionResourceStates)
    .values({
      connectionId: input.connectionId,
      familyId: input.familyId,
      kind: input.kind,
      syncState: IntegrationConnectionResourceSyncStates.ERROR,
      lastSyncFinishedAt: sql`now()`,
      lastErrorCode: input.failure.code,
      lastErrorMessage: input.failure.message,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [
        integrationConnectionResourceStates.connectionId,
        integrationConnectionResourceStates.kind,
      ],
      set: {
        familyId: input.familyId,
        syncState: IntegrationConnectionResourceSyncStates.ERROR,
        lastSyncFinishedAt: sql`now()`,
        lastErrorCode: input.failure.code,
        lastErrorMessage: input.failure.message,
        updatedAt: sql`now()`,
      },
    });
}
