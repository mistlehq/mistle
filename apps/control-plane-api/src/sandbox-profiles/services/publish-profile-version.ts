import {
  sandboxProfileVersionSnapshotJobs,
  sandboxProfileVersions,
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionSnapshotJobTriggers,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { sql } from "drizzle-orm";
import { typeid } from "typeid-js";

import {
  SandboxProfilesConflictCodes,
  SandboxProfilesConflictError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import { getProfileVersionPublishability } from "./get-profile-version-publishability.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type PublishProfileVersionInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
};

type PublishProfileVersionOutput = {
  version: {
    sandboxProfileId: string;
    version: number;
    state: (typeof SandboxProfileVersionStates)[keyof typeof SandboxProfileVersionStates];
    isActive: boolean;
  };
  activeVersion: number | null;
  snapshotJob: {
    id: string;
    trigger: (typeof SandboxProfileVersionSnapshotJobTriggers)[keyof typeof SandboxProfileVersionSnapshotJobTriggers];
    state: (typeof SandboxProfileVersionSnapshotJobStates)[keyof typeof SandboxProfileVersionSnapshotJobStates];
  };
};

async function markQueuedSnapshotJobFailedToEnqueue(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: {
    snapshotJobId: string;
    message: string;
  },
): Promise<void> {
  await db
    .update(sandboxProfileVersionSnapshotJobs)
    .set({
      state: SandboxProfileVersionSnapshotJobStates.FAILED,
      finishedAt: sql`now()`,
      errorCode: "snapshot_materialization_enqueue_failed",
      errorMessage: input.message,
      updatedAt: sql`now()`,
    })
    .where(
      sql`${sandboxProfileVersionSnapshotJobs.id} = ${input.snapshotJobId}
        and ${sandboxProfileVersionSnapshotJobs.state} = ${SandboxProfileVersionSnapshotJobStates.QUEUED}`,
    );
}

export async function publishProfileVersion(
  {
    db,
    dataPlaneClient,
    defaultBaseImage,
  }: Pick<CreateSandboxProfilesServiceInput, "db" | "dataPlaneClient"> & {
    defaultBaseImage: string;
  },
  input: PublishProfileVersionInput,
): Promise<PublishProfileVersionOutput> {
  const sandboxInstanceId = typeid("sbi").toString();

  const publishedResult = await db.transaction(async (tx) => {
    const sandboxProfile = await tx.query.sandboxProfiles.findFirst({
      columns: {
        id: true,
        activeVersion: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.id, input.profileId), eq(table.organizationId, input.organizationId)),
    });

    if (sandboxProfile === undefined) {
      throw new SandboxProfilesNotFoundError(
        SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
        "Sandbox profile was not found.",
      );
    }

    const sandboxProfileVersion = await tx.query.sandboxProfileVersions.findFirst({
      columns: {
        sandboxProfileId: true,
        version: true,
        state: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, input.profileId), eq(table.version, input.profileVersion)),
    });

    if (sandboxProfileVersion === undefined) {
      throw new SandboxProfilesNotFoundError(
        SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
        "Sandbox profile version was not found.",
      );
    }

    if (sandboxProfileVersion.state !== SandboxProfileVersionStates.DRAFT) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_DRAFT,
        `Sandbox profile version '${String(input.profileVersion)}' is not a draft.`,
      );
    }

    const publishability = await getProfileVersionPublishability(
      {
        db: tx,
      },
      input,
    );

    if (!publishability.publishable) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_PUBLISHABLE,
        `Sandbox profile version '${String(input.profileVersion)}' is not publishable.`,
      );
    }

    const [publishedVersion] = await tx
      .update(sandboxProfileVersions)
      .set({
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: sql`now()`,
      })
      .where(
        sql`${sandboxProfileVersions.sandboxProfileId} = ${input.profileId}
          and ${sandboxProfileVersions.version} = ${input.profileVersion}
          and ${sandboxProfileVersions.state} = ${SandboxProfileVersionStates.DRAFT}`,
      )
      .returning({
        sandboxProfileId: sandboxProfileVersions.sandboxProfileId,
        version: sandboxProfileVersions.version,
        state: sandboxProfileVersions.state,
      });

    if (publishedVersion === undefined) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_DRAFT,
        `Sandbox profile version '${String(input.profileVersion)}' is not a draft.`,
      );
    }

    const [snapshotJob] = await tx
      .insert(sandboxProfileVersionSnapshotJobs)
      .values({
        sandboxProfileId: input.profileId,
        sandboxProfileVersion: input.profileVersion,
        trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
        state: SandboxProfileVersionSnapshotJobStates.QUEUED,
      })
      .returning({
        id: sandboxProfileVersionSnapshotJobs.id,
        trigger: sandboxProfileVersionSnapshotJobs.trigger,
        state: sandboxProfileVersionSnapshotJobs.state,
      });

    if (snapshotJob === undefined) {
      throw new Error(
        `Failed to create snapshot job for sandbox profile '${input.profileId}' version '${String(input.profileVersion)}'.`,
      );
    }

    return {
      version: {
        ...publishedVersion,
        isActive: false,
      },
      activeVersion: sandboxProfile.activeVersion,
      snapshotJob,
    };
  });

  try {
    await dataPlaneClient.materializeSandboxProfileVersionSnapshotJob({
      snapshotJobId: publishedResult.snapshotJob.id,
      sandboxInstanceId,
      organizationId: input.organizationId,
      sandboxProfileId: input.profileId,
      sandboxProfileVersion: input.profileVersion,
      image: {
        imageId: defaultBaseImage,
        createdAt: new Date().toISOString(),
        kind: "base",
      },
    });
  } catch (error) {
    await markQueuedSnapshotJobFailedToEnqueue(
      {
        db,
      },
      {
        snapshotJobId: publishedResult.snapshotJob.id,
        message: `Failed to enqueue snapshot materialization for sandbox profile '${input.profileId}' version '${String(input.profileVersion)}'.`,
      },
    );
    throw error;
  }

  return publishedResult;
}
