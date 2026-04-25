import {
  sandboxProfileVersionSnapshotJobs,
  sandboxProfileVersions,
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionSnapshotJobTriggers,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";
import { typeid } from "typeid-js";

import {
  SandboxProfilesConflictCodes,
  SandboxProfilesConflictError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import { enqueueSnapshotMaterializationJob } from "./enqueue-snapshot-materialization-job.js";
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
    usable: boolean;
    latestSnapshotJob: {
      id: string;
      trigger: (typeof SandboxProfileVersionSnapshotJobTriggers)[keyof typeof SandboxProfileVersionSnapshotJobTriggers];
      state: (typeof SandboxProfileVersionSnapshotJobStates)[keyof typeof SandboxProfileVersionSnapshotJobStates];
      errorCode: string | null;
      errorMessage: string | null;
      createdAt: string;
      startedAt: string | null;
      finishedAt: string | null;
    };
  };
  activeVersion: number | null;
  snapshotJob: {
    id: string;
    trigger: (typeof SandboxProfileVersionSnapshotJobTriggers)[keyof typeof SandboxProfileVersionSnapshotJobTriggers];
    state: (typeof SandboxProfileVersionSnapshotJobStates)[keyof typeof SandboxProfileVersionSnapshotJobStates];
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  };
};

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
        and(
          eq(sandboxProfileVersions.sandboxProfileId, input.profileId),
          eq(sandboxProfileVersions.version, input.profileVersion),
          eq(sandboxProfileVersions.state, SandboxProfileVersionStates.DRAFT),
        ),
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
        errorCode: sandboxProfileVersionSnapshotJobs.errorCode,
        errorMessage: sandboxProfileVersionSnapshotJobs.errorMessage,
        createdAt: sandboxProfileVersionSnapshotJobs.createdAt,
        startedAt: sandboxProfileVersionSnapshotJobs.startedAt,
        finishedAt: sandboxProfileVersionSnapshotJobs.finishedAt,
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
        usable: false,
        latestSnapshotJob: snapshotJob,
      },
      activeVersion: sandboxProfile.activeVersion,
      snapshotJob,
    };
  });

  await enqueueSnapshotMaterializationJob(
    {
      db,
      dataPlaneClient,
      defaultBaseImage,
    },
    {
      snapshotJobId: publishedResult.snapshotJob.id,
      sandboxInstanceId,
      organizationId: input.organizationId,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
    },
  );

  return publishedResult;
}
