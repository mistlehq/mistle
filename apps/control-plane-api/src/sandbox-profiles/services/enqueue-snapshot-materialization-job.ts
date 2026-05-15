import {
  getControlPlaneDatabaseSchema,
  SandboxProfileVersionSnapshotJobStates,
} from "@mistle/db/control-plane";
import type { SandboxRuntimeProviderInput } from "@mistle/workflow-registry/data-plane";
import { and, eq, sql } from "drizzle-orm";

import type { CreateSandboxProfilesServiceInput } from "./types.js";

export type SnapshotMaterializationImageInput = {
  imageId: string;
  createdAt: string;
  kind: "base" | "snapshot";
  provider: SandboxRuntimeProviderInput["provider"];
};

async function markQueuedSnapshotJobFailedToEnqueue(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: {
    snapshotJobId: string;
    message: string;
  },
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(db);

  await db
    .update(tables.sandboxProfileVersionSnapshotJobs)
    .set({
      state: SandboxProfileVersionSnapshotJobStates.FAILED,
      finishedAt: sql`now()`,
      errorCode: "snapshot_materialization_enqueue_failed",
      errorMessage: input.message,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.sandboxProfileVersionSnapshotJobs.id, input.snapshotJobId),
        eq(
          tables.sandboxProfileVersionSnapshotJobs.state,
          SandboxProfileVersionSnapshotJobStates.QUEUED,
        ),
      ),
    );
}

export async function enqueueSnapshotMaterializationJob(
  { db, dataPlaneClient }: Pick<CreateSandboxProfilesServiceInput, "db" | "dataPlaneClient">,
  input: {
    snapshotJobId: string;
    sandboxInstanceId: string;
    organizationId: string;
    profileId: string;
    profileVersion: number;
    snapshotPreparationScriptKind: "setup" | "maintenance";
    image: SnapshotMaterializationImageInput;
    sandboxRuntime: SandboxRuntimeProviderInput;
  },
): Promise<void> {
  try {
    await dataPlaneClient.materializeSandboxProfileVersionSnapshotJob({
      snapshotJobId: input.snapshotJobId,
      sandboxInstanceId: input.sandboxInstanceId,
      organizationId: input.organizationId,
      sandboxProfileId: input.profileId,
      sandboxProfileVersion: input.profileVersion,
      snapshotPreparationScriptKind: input.snapshotPreparationScriptKind,
      image: input.image,
      sandboxRuntime: input.sandboxRuntime,
    });
  } catch (error) {
    await markQueuedSnapshotJobFailedToEnqueue(
      {
        db,
      },
      {
        snapshotJobId: input.snapshotJobId,
        message: `Failed to enqueue snapshot materialization for sandbox profile '${input.profileId}' version '${String(input.profileVersion)}'.`,
      },
    );
    throw error;
  }
}
