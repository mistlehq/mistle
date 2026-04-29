import { SandboxInstancePurposes } from "@mistle/db/data-plane";
import { NotFoundError } from "@mistle/http/errors.js";

import {
  SandboxProfilesBadRequestCodes,
  SandboxProfilesBadRequestError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import { listProfileVersionRepositoryOptions } from "./repository-options.js";
import { startProfileInstance } from "./start-profile-instance.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

const SetupCheckStatuses = {
  STARTING_SANDBOX: "starting_sandbox",
  RUNNING: "running",
  CLEANING_UP: "cleaning_up",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CLEANUP_FAILED: "cleanup_failed",
} as const;

type SetupCheckStatus = (typeof SetupCheckStatuses)[keyof typeof SetupCheckStatuses];

const SetupCheckFailurePhases = {
  COMPILE: "compile",
  START: "start",
  RUNTIME_READY: "runtime_ready",
  SCRIPT: "script",
  CLEANUP: "cleanup",
} as const;

type SetupCheckFailurePhase =
  (typeof SetupCheckFailurePhases)[keyof typeof SetupCheckFailurePhases];

type SetupCheckOutput = {
  id: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  status: SetupCheckStatus;
  failurePhase: SetupCheckFailurePhase | null;
  failureCode: string | null;
  failureMessage: string | null;
  sandboxInstanceId: string;
  workflowRunId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

type CreateProfileVersionSetupCheckInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  requestedByUserId: string;
  setupScript: string | null;
  primaryRepositoryId?: string | null;
  idempotencyKey?: string;
};

type GetProfileVersionSetupCheckInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  setupCheckId: string;
};

async function verifyProfileVersionExists(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
  },
): Promise<void> {
  const sandboxProfile = await db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
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

  const sandboxProfileVersion = await db.query.sandboxProfileVersions.findFirst({
    columns: {
      sandboxProfileId: true,
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
}

async function validatePrimaryRepositoryId(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
    primaryRepositoryId?: string | null;
  },
): Promise<void> {
  if (input.primaryRepositoryId === undefined || input.primaryRepositoryId === null) {
    return;
  }

  const repositoryOptions = await listProfileVersionRepositoryOptions(
    {
      db,
    },
    {
      organizationId: input.organizationId,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
    },
  );

  if (repositoryOptions.some((option) => option.id === input.primaryRepositoryId)) {
    return;
  }

  throw new SandboxProfilesBadRequestError(
    SandboxProfilesBadRequestCodes.INVALID_PRIMARY_REPOSITORY,
    `Primary repository '${input.primaryRepositoryId}' is not available for sandbox profile '${input.profileId}' version ${String(input.profileVersion)}.`,
  );
}

function toAcceptedSetupCheckOutput(input: {
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  sandboxInstanceId: string;
  workflowRunId: string;
}): SetupCheckOutput {
  return {
    id: input.sandboxInstanceId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
    status: SetupCheckStatuses.STARTING_SANDBOX,
    failurePhase: null,
    failureCode: null,
    failureMessage: null,
    sandboxInstanceId: input.sandboxInstanceId,
    workflowRunId: input.workflowRunId,
    startedAt: null,
    finishedAt: null,
  };
}

function toFailedSetupCheckOutput(input: {
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  sandboxInstanceId: string;
  failureCode: string | null;
  failureMessage: string | null;
  failedAt: string | null;
}): SetupCheckOutput {
  return {
    id: input.sandboxInstanceId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
    status: SetupCheckStatuses.FAILED,
    failurePhase: SetupCheckFailurePhases.START,
    failureCode: input.failureCode ?? "SETUP_CHECK_SANDBOX_FAILED",
    failureMessage: input.failureMessage ?? "Setup check sandbox failed before it became ready.",
    sandboxInstanceId: input.sandboxInstanceId,
    workflowRunId: null,
    startedAt: null,
    finishedAt: input.failedAt,
  };
}

function toSucceededSetupCheckOutput(input: {
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  sandboxInstanceId: string;
  startedAt: string | null;
  stoppedAt: string | null;
}): SetupCheckOutput {
  return {
    id: input.sandboxInstanceId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
    status: SetupCheckStatuses.SUCCEEDED,
    failurePhase: null,
    failureCode: null,
    failureMessage: null,
    sandboxInstanceId: input.sandboxInstanceId,
    workflowRunId: null,
    startedAt: input.startedAt,
    finishedAt: input.stoppedAt,
  };
}

export async function createProfileVersionSetupCheck(
  {
    db,
    integrationsConfig,
    dataPlaneClient,
    defaultBaseImage,
  }: Pick<CreateSandboxProfilesServiceInput, "db" | "integrationsConfig" | "dataPlaneClient"> & {
    defaultBaseImage: string;
  },
  input: CreateProfileVersionSetupCheckInput,
): Promise<SetupCheckOutput> {
  await verifyProfileVersionExists({ db }, input);

  if (input.idempotencyKey !== undefined) {
    const existingSetupCheck = await dataPlaneClient.getSandboxInstanceByStartIdempotency({
      organizationId: input.organizationId,
      sandboxProfileId: input.profileId,
      sandboxProfileVersion: input.profileVersion,
      purpose: SandboxInstancePurposes.SETUP_CHECK,
      source: "dashboard",
      idempotencyKey: input.idempotencyKey,
    });

    if (existingSetupCheck !== null) {
      return toAcceptedSetupCheckOutput({
        sandboxProfileId: input.profileId,
        sandboxProfileVersion: input.profileVersion,
        sandboxInstanceId: existingSetupCheck.sandboxInstanceId,
        workflowRunId: existingSetupCheck.workflowRunId,
      });
    }
  }

  await validatePrimaryRepositoryId({ db }, input);

  const startedSandbox = await startProfileInstance(
    {
      db,
      integrationsConfig,
      dataPlaneClient,
      defaultBaseImage,
    },
    {
      organizationId: input.organizationId,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
      purpose: SandboxInstancePurposes.SETUP_CHECK,
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      setupScript: input.setupScript,
      startedBy: {
        kind: "user",
        id: input.requestedByUserId,
      },
      actingUser: {
        userId: input.requestedByUserId,
      },
      source: "dashboard",
      ...(input.primaryRepositoryId === undefined
        ? {}
        : { primaryRepositoryId: input.primaryRepositoryId }),
    },
  );

  return toAcceptedSetupCheckOutput({
    sandboxProfileId: input.profileId,
    sandboxProfileVersion: input.profileVersion,
    sandboxInstanceId: startedSandbox.sandboxInstanceId,
    workflowRunId: startedSandbox.workflowRunId,
  });
}

export async function getProfileVersionSetupCheck(
  { db, dataPlaneClient }: Pick<CreateSandboxProfilesServiceInput, "db" | "dataPlaneClient">,
  input: GetProfileVersionSetupCheckInput,
): Promise<SetupCheckOutput> {
  await verifyProfileVersionExists({ db }, input);

  const sandboxInstance = await dataPlaneClient.getSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.setupCheckId,
    purpose: SandboxInstancePurposes.SETUP_CHECK,
  });

  if (
    sandboxInstance === null ||
    sandboxInstance.sandboxProfileId !== input.profileId ||
    sandboxInstance.sandboxProfileVersion !== input.profileVersion
  ) {
    throw new NotFoundError("SETUP_CHECK_NOT_FOUND", "Sandbox profile setup check was not found.");
  }

  if (sandboxInstance.status === "pending" || sandboxInstance.status === "starting") {
    return {
      id: sandboxInstance.id,
      sandboxProfileId: sandboxInstance.sandboxProfileId,
      sandboxProfileVersion: sandboxInstance.sandboxProfileVersion,
      status: SetupCheckStatuses.STARTING_SANDBOX,
      failurePhase: null,
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
      sandboxInstanceId: sandboxInstance.id,
      workflowRunId: null,
      startedAt: sandboxInstance.startedAt,
      finishedAt: null,
    };
  }

  if (sandboxInstance.status === "failed") {
    return toFailedSetupCheckOutput({
      sandboxProfileId: sandboxInstance.sandboxProfileId,
      sandboxProfileVersion: sandboxInstance.sandboxProfileVersion,
      sandboxInstanceId: sandboxInstance.id,
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
      failedAt: sandboxInstance.failedAt,
    });
  }

  if (sandboxInstance.status === "stopped") {
    return toSucceededSetupCheckOutput({
      sandboxProfileId: sandboxInstance.sandboxProfileId,
      sandboxProfileVersion: sandboxInstance.sandboxProfileVersion,
      sandboxInstanceId: sandboxInstance.id,
      startedAt: sandboxInstance.startedAt,
      stoppedAt: sandboxInstance.stoppedAt,
    });
  }

  try {
    await dataPlaneClient.stopSandboxInstance({
      sandboxInstanceId: sandboxInstance.id,
      stopReason: "system",
      expectedPurpose: SandboxInstancePurposes.SETUP_CHECK,
      idempotencyKey: `setup-check-cleanup:${sandboxInstance.id}`,
    });
  } catch (error) {
    return {
      id: sandboxInstance.id,
      sandboxProfileId: sandboxInstance.sandboxProfileId,
      sandboxProfileVersion: sandboxInstance.sandboxProfileVersion,
      status: SetupCheckStatuses.CLEANUP_FAILED,
      failurePhase: SetupCheckFailurePhases.CLEANUP,
      failureCode: "SETUP_CHECK_CLEANUP_START_FAILED",
      failureMessage:
        error instanceof Error
          ? error.message
          : "Failed to stop setup check sandbox after successful startup.",
      sandboxInstanceId: sandboxInstance.id,
      workflowRunId: null,
      startedAt: sandboxInstance.startedAt,
      finishedAt: null,
    };
  }

  return {
    id: sandboxInstance.id,
    sandboxProfileId: sandboxInstance.sandboxProfileId,
    sandboxProfileVersion: sandboxInstance.sandboxProfileVersion,
    status: SetupCheckStatuses.CLEANING_UP,
    failurePhase: null,
    failureCode: null,
    failureMessage: null,
    sandboxInstanceId: sandboxInstance.id,
    workflowRunId: null,
    startedAt: sandboxInstance.startedAt,
    finishedAt: null,
  };
}

export type {
  CreateProfileVersionSetupCheckInput,
  GetProfileVersionSetupCheckInput,
  SetupCheckOutput,
};
