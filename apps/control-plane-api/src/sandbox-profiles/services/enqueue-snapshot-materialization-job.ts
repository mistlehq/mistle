import {
  getControlPlaneDatabaseSchema,
  SandboxProfileVersionSnapshotJobStates,
} from "@mistle/db/control-plane";
import type { SandboxRuntimeProviderInput } from "@mistle/workflow-registry/data-plane";
import { and, eq, sql } from "drizzle-orm";

import type { CreateSandboxProfilesServiceInput } from "./types.js";

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
  {
    db,
    dataPlaneClient,
    defaultBaseImage,
  }: Pick<CreateSandboxProfilesServiceInput, "db" | "dataPlaneClient"> & {
    defaultBaseImage: string;
  },
  input: {
    snapshotJobId: string;
    sandboxInstanceId: string;
    organizationId: string;
    profileId: string;
    profileVersion: number;
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
      image: {
        imageId: defaultBaseImage,
        createdAt: new Date().toISOString(),
        kind: "base",
        provider: input.sandboxRuntime.provider,
      },
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
