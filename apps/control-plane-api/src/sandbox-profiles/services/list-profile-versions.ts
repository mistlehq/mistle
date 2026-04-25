import type {
  SandboxProfileVersionSnapshotJobState,
  SandboxProfileVersionSnapshotJobTrigger,
  SandboxProfileVersionState,
} from "@mistle/db/control-plane";
import { SandboxProfileVersionStates } from "@mistle/db/control-plane";

import { SandboxProfilesNotFoundCodes, SandboxProfilesNotFoundError } from "../errors.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type ListProfileVersionsInput = {
  organizationId: string;
  profileId: string;
};

type ListProfileVersionsOutput = {
  versions: Array<{
    sandboxProfileId: string;
    version: number;
    state: SandboxProfileVersionState;
    isActive: boolean;
    usable: boolean;
    latestSnapshotJob: {
      id: string;
      trigger: SandboxProfileVersionSnapshotJobTrigger;
      state: SandboxProfileVersionSnapshotJobState;
      errorCode: string | null;
      errorMessage: string | null;
      createdAt: string;
      startedAt: string | null;
      finishedAt: string | null;
    } | null;
  }>;
};

export async function listProfileVersions(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: ListProfileVersionsInput,
): Promise<ListProfileVersionsOutput> {
  const sandboxProfile = await db.query.sandboxProfiles.findFirst({
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

  const versions = await db.query.sandboxProfileVersions.findMany({
    columns: {
      sandboxProfileId: true,
      version: true,
      state: true,
      snapshotImageProvider: true,
      snapshotImageId: true,
    },
    where: (table, { eq }) => eq(table.sandboxProfileId, input.profileId),
    orderBy: (table, { desc }) => [desc(table.version)],
  });

  const latestJobs = await db.query.sandboxProfileVersionSnapshotJobs.findMany({
    columns: {
      id: true,
      sandboxProfileVersion: true,
      trigger: true,
      state: true,
      errorCode: true,
      errorMessage: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
    },
    where: (table, { eq }) => eq(table.sandboxProfileId, input.profileId),
    orderBy: (table, { desc }) => [desc(table.sandboxProfileVersion), desc(table.createdAt)],
  });

  const latestJobsByVersion = new Map<number, (typeof latestJobs)[number]>();
  for (const job of latestJobs) {
    if (latestJobsByVersion.has(job.sandboxProfileVersion)) {
      continue;
    }

    latestJobsByVersion.set(job.sandboxProfileVersion, job);
  }

  return {
    versions: versions.map((version) => {
      const latestJob = latestJobsByVersion.get(version.version);

      return {
        sandboxProfileId: version.sandboxProfileId,
        version: version.version,
        state: version.state,
        isActive: version.version === sandboxProfile.activeVersion,
        usable:
          version.state === SandboxProfileVersionStates.PUBLISHED &&
          version.snapshotImageProvider !== null &&
          version.snapshotImageId !== null,
        latestSnapshotJob:
          latestJob === undefined
            ? null
            : {
                id: latestJob.id,
                trigger: latestJob.trigger,
                state: latestJob.state,
                errorCode: latestJob.errorCode,
                errorMessage: latestJob.errorMessage,
                createdAt: latestJob.createdAt,
                startedAt: latestJob.startedAt,
                finishedAt: latestJob.finishedAt,
              },
      };
    }),
  };
}

export type { ListProfileVersionsInput, ListProfileVersionsOutput };
