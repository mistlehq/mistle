import {
  sandboxProfileSetupChecks,
  SandboxProfileSetupCheckFailurePhases,
  type SandboxProfileSetupCheckFailurePhase,
  SandboxProfileSetupCheckStatuses,
  type SandboxProfileSetupCheckStatus,
} from "@mistle/db/control-plane";
import { SandboxInstancePurposes } from "@mistle/db/data-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import { eq, sql } from "drizzle-orm";

import {
  SandboxProfilesCompileError,
  SandboxProfilesBadRequestCodes,
  SandboxProfilesBadRequestError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import { listProfileVersionRepositoryOptions } from "./repository-options.js";
import { startProfileInstance } from "./start-profile-instance.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type SetupCheckOutput = {
  id: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  requestedByUserId: string | null;
  setupScript: string | null;
  primaryRepositoryId: string | null;
  status: SandboxProfileSetupCheckStatus;
  failurePhase: SandboxProfileSetupCheckFailurePhase | null;
  failureCode: string | null;
  failureMessage: string | null;
  sandboxInstanceId: string | null;
  workflowRunId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
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

const TerminalSetupCheckStatuses: ReadonlySet<SandboxProfileSetupCheckStatus> = new Set([
  SandboxProfileSetupCheckStatuses.SUCCEEDED,
  SandboxProfileSetupCheckStatuses.FAILED,
  SandboxProfileSetupCheckStatuses.CLEANUP_FAILED,
]);

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

async function findSetupCheckByIdempotencyKey(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
    idempotencyKey?: string;
  },
): Promise<SetupCheckOutput | null> {
  if (input.idempotencyKey === undefined) {
    return null;
  }
  const idempotencyKey = input.idempotencyKey;

  const setupCheck = await db.query.sandboxProfileSetupChecks.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.sandboxProfileId, input.profileId),
        eq(table.sandboxProfileVersion, input.profileVersion),
        eq(table.idempotencyKey, idempotencyKey),
      ),
  });

  if (setupCheck === undefined) {
    return null;
  }

  return toSetupCheckOutput(setupCheck);
}

async function markSetupCheckStartFailed(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: {
    setupCheckId: string;
    error: unknown;
  },
): Promise<void> {
  const failureMessage =
    input.error instanceof Error ? input.error.message : "Failed to start setup check sandbox.";
  const failurePhase =
    input.error instanceof SandboxProfilesCompileError
      ? SandboxProfileSetupCheckFailurePhases.COMPILE
      : SandboxProfileSetupCheckFailurePhases.START;
  const failureCode =
    input.error instanceof SandboxProfilesCompileError
      ? input.error.code
      : "SETUP_CHECK_START_FAILED";

  await db
    .update(sandboxProfileSetupChecks)
    .set({
      status: SandboxProfileSetupCheckStatuses.FAILED,
      failurePhase,
      failureCode,
      failureMessage,
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(sandboxProfileSetupChecks.id, input.setupCheckId));
}

async function startCreatedSetupCheck(
  {
    db,
    integrationsConfig,
    dataPlaneClient,
    defaultBaseImage,
  }: Pick<CreateSandboxProfilesServiceInput, "db" | "integrationsConfig" | "dataPlaneClient"> & {
    defaultBaseImage: string;
  },
  input: CreateProfileVersionSetupCheckInput & {
    setupCheckId: string;
  },
): Promise<SetupCheckOutput> {
  await db
    .update(sandboxProfileSetupChecks)
    .set({
      status: SandboxProfileSetupCheckStatuses.COMPILING_PROFILE,
      updatedAt: sql`now()`,
    })
    .where(eq(sandboxProfileSetupChecks.id, input.setupCheckId));

  try {
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
        idempotencyKey: input.setupCheckId,
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

    const [startedSetupCheck] = await db
      .update(sandboxProfileSetupChecks)
      .set({
        status: SandboxProfileSetupCheckStatuses.STARTING_SANDBOX,
        sandboxInstanceId: startedSandbox.sandboxInstanceId,
        workflowRunId: startedSandbox.workflowRunId,
        startedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(sandboxProfileSetupChecks.id, input.setupCheckId))
      .returning();

    if (startedSetupCheck === undefined) {
      throw new Error(`Setup check '${input.setupCheckId}' disappeared before start completed.`);
    }

    return toSetupCheckOutput(startedSetupCheck);
  } catch (error) {
    await markSetupCheckStartFailed(
      {
        db,
      },
      {
        setupCheckId: input.setupCheckId,
        error,
      },
    );
    throw error;
  }
}

function toSetupCheckOutput(
  setupCheck: typeof sandboxProfileSetupChecks.$inferSelect,
): SetupCheckOutput {
  return {
    id: setupCheck.id,
    sandboxProfileId: setupCheck.sandboxProfileId,
    sandboxProfileVersion: setupCheck.sandboxProfileVersion,
    requestedByUserId: setupCheck.requestedByUserId,
    setupScript: setupCheck.setupScript,
    primaryRepositoryId: setupCheck.primaryRepositoryId,
    status: setupCheck.status,
    failurePhase: setupCheck.failurePhase,
    failureCode: setupCheck.failureCode,
    failureMessage: setupCheck.failureMessage,
    sandboxInstanceId: setupCheck.sandboxInstanceId,
    workflowRunId: setupCheck.workflowRunId,
    startedAt: setupCheck.startedAt,
    finishedAt: setupCheck.finishedAt,
    createdAt: setupCheck.createdAt,
    updatedAt: setupCheck.updatedAt,
  };
}

async function updateSetupCheckFromSandboxInstance(
  { db, dataPlaneClient }: Pick<CreateSandboxProfilesServiceInput, "db" | "dataPlaneClient">,
  setupCheck: typeof sandboxProfileSetupChecks.$inferSelect,
): Promise<typeof sandboxProfileSetupChecks.$inferSelect> {
  if (setupCheck.sandboxInstanceId === null || TerminalSetupCheckStatuses.has(setupCheck.status)) {
    return setupCheck;
  }

  const sandboxInstance = await dataPlaneClient.getSandboxInstance({
    organizationId: setupCheck.organizationId,
    instanceId: setupCheck.sandboxInstanceId,
    includeSetupChecks: true,
  });

  if (sandboxInstance === null) {
    throw new Error(
      `Setup check '${setupCheck.id}' references missing sandbox instance '${setupCheck.sandboxInstanceId}'.`,
    );
  }

  if (sandboxInstance.status === "pending" || sandboxInstance.status === "starting") {
    return setupCheck;
  }

  if (sandboxInstance.status === "running") {
    if (setupCheck.status === SandboxProfileSetupCheckStatuses.CLEANING_UP) {
      return setupCheck;
    }

    const [cleaningUpSetupCheck] = await db
      .update(sandboxProfileSetupChecks)
      .set({
        status: SandboxProfileSetupCheckStatuses.CLEANING_UP,
        failurePhase: null,
        failureCode: null,
        failureMessage: null,
        updatedAt: sql`now()`,
      })
      .where(eq(sandboxProfileSetupChecks.id, setupCheck.id))
      .returning();

    if (cleaningUpSetupCheck === undefined) {
      throw new Error(`Setup check '${setupCheck.id}' disappeared before cleanup started.`);
    }

    try {
      await dataPlaneClient.stopSandboxInstance({
        sandboxInstanceId: setupCheck.sandboxInstanceId,
        stopReason: "system",
        idempotencyKey: `setup-check-cleanup:${setupCheck.id}`,
      });
    } catch (error) {
      const failureMessage =
        error instanceof Error
          ? error.message
          : "Failed to stop setup check sandbox after successful startup.";

      const [cleanupFailedSetupCheck] = await db
        .update(sandboxProfileSetupChecks)
        .set({
          status: SandboxProfileSetupCheckStatuses.CLEANUP_FAILED,
          failurePhase: SandboxProfileSetupCheckFailurePhases.CLEANUP,
          failureCode: "SETUP_CHECK_CLEANUP_START_FAILED",
          failureMessage,
          finishedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(sandboxProfileSetupChecks.id, setupCheck.id))
        .returning();

      if (cleanupFailedSetupCheck === undefined) {
        throw new Error(`Setup check '${setupCheck.id}' disappeared after cleanup failed.`);
      }

      return cleanupFailedSetupCheck;
    }

    return cleaningUpSetupCheck;
  }

  if (
    sandboxInstance.status === "stopped" &&
    setupCheck.status === SandboxProfileSetupCheckStatuses.CLEANING_UP
  ) {
    const [succeededSetupCheck] = await db
      .update(sandboxProfileSetupChecks)
      .set({
        status: SandboxProfileSetupCheckStatuses.SUCCEEDED,
        failurePhase: null,
        failureCode: null,
        failureMessage: null,
        finishedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(sandboxProfileSetupChecks.id, setupCheck.id))
      .returning();

    if (succeededSetupCheck === undefined) {
      throw new Error(`Setup check '${setupCheck.id}' disappeared before success completed.`);
    }

    return succeededSetupCheck;
  }

  const update =
    sandboxInstance.status === "stopped"
      ? {
          failureCode: sandboxInstance.failureCode ?? "SETUP_CHECK_SANDBOX_STOPPED",
          failureMessage:
            sandboxInstance.failureMessage ??
            "Setup check sandbox stopped before cleanup was requested.",
        }
      : {
          failureCode: sandboxInstance.failureCode ?? "SETUP_CHECK_SANDBOX_FAILED",
          failureMessage:
            sandboxInstance.failureMessage ?? "Setup check sandbox failed before it became ready.",
        };

  const [updatedSetupCheck] = await db
    .update(sandboxProfileSetupChecks)
    .set({
      status: SandboxProfileSetupCheckStatuses.FAILED,
      failurePhase: SandboxProfileSetupCheckFailurePhases.START,
      failureCode: update.failureCode,
      failureMessage: update.failureMessage,
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(sandboxProfileSetupChecks.id, setupCheck.id))
    .returning();

  if (updatedSetupCheck === undefined) {
    throw new Error(`Setup check '${setupCheck.id}' disappeared before status reconciliation.`);
  }

  return updatedSetupCheck;
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

  const existingSetupCheck = await findSetupCheckByIdempotencyKey({ db }, input);
  if (existingSetupCheck !== null) {
    return existingSetupCheck;
  }

  await validatePrimaryRepositoryId({ db }, input);

  const [createdSetupCheck] = await db
    .insert(sandboxProfileSetupChecks)
    .values({
      organizationId: input.organizationId,
      sandboxProfileId: input.profileId,
      sandboxProfileVersion: input.profileVersion,
      requestedByUserId: input.requestedByUserId,
      setupScript: input.setupScript,
      primaryRepositoryId: input.primaryRepositoryId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      status: SandboxProfileSetupCheckStatuses.QUEUED,
    })
    .onConflictDoNothing()
    .returning();

  if (createdSetupCheck !== undefined) {
    return startCreatedSetupCheck(
      {
        db,
        integrationsConfig,
        dataPlaneClient,
        defaultBaseImage,
      },
      {
        ...input,
        setupCheckId: createdSetupCheck.id,
      },
    );
  }

  const idempotencyKey = input.idempotencyKey;
  if (idempotencyKey === undefined) {
    throw new Error("Setup check insert did not return a row and no idempotency key was provided.");
  }

  const concurrentlyCreatedSetupCheck = await findSetupCheckByIdempotencyKey({ db }, input);
  if (concurrentlyCreatedSetupCheck === null) {
    throw new Error("Setup check insert conflicted but the idempotent setup check was not found.");
  }

  return concurrentlyCreatedSetupCheck;
}

export async function getProfileVersionSetupCheck(
  { db, dataPlaneClient }: Pick<CreateSandboxProfilesServiceInput, "db" | "dataPlaneClient">,
  input: GetProfileVersionSetupCheckInput,
): Promise<SetupCheckOutput> {
  await verifyProfileVersionExists({ db }, input);

  const setupCheck = await db.query.sandboxProfileSetupChecks.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.id, input.setupCheckId),
        eq(table.organizationId, input.organizationId),
        eq(table.sandboxProfileId, input.profileId),
        eq(table.sandboxProfileVersion, input.profileVersion),
      ),
  });

  if (setupCheck === undefined) {
    throw new NotFoundError("SETUP_CHECK_NOT_FOUND", "Sandbox profile setup check was not found.");
  }

  const reconciledSetupCheck = await updateSetupCheckFromSandboxInstance(
    {
      db,
      dataPlaneClient,
    },
    setupCheck,
  );

  return toSetupCheckOutput(reconciledSetupCheck);
}

export type {
  CreateProfileVersionSetupCheckInput,
  GetProfileVersionSetupCheckInput,
  SetupCheckOutput,
};
