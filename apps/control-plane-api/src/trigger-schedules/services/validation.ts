import { type ControlPlaneDatabase, type ControlPlaneTransaction } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import { findNextScheduleOccurrence } from "@mistle/time";

import { listProfileVersionRepositoryOptions } from "../../sandbox-profiles/services/repository-options.js";
import { TriggerSchedulesBadRequestCodes } from "../constants.js";

export function resolveNextScheduledAtOrThrow(input: {
  cronExpression: string;
  timezone: string;
  now: Date;
}): string | null {
  try {
    const occurrence = findNextScheduleOccurrence({
      after: input.now,
      cronExpression: input.cronExpression,
      timezone: input.timezone,
    });

    return occurrence?.scheduledAt.toISOString() ?? null;
  } catch (error) {
    throw new BadRequestError(
      TriggerSchedulesBadRequestCodes.INVALID_SCHEDULE,
      error instanceof Error ? error.message : "Invalid schedule.",
    );
  }
}

export async function resolveSandboxProfileVersionOrThrow(
  ctx: { db: ControlPlaneDatabase | ControlPlaneTransaction },
  input: {
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion?: number | undefined;
  },
): Promise<number> {
  const profile = await ctx.db.query.sandboxProfiles.findFirst({
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.sandboxProfileId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });

  if (profile === undefined) {
    throw new BadRequestError(
      TriggerSchedulesBadRequestCodes.INVALID_SANDBOX_PROFILE_REFERENCE,
      "Sandbox profile must reference a profile in the active organization.",
    );
  }

  const resolvedVersion = input.sandboxProfileVersion ?? profile.activeVersion;
  if (resolvedVersion === null) {
    throw new BadRequestError(
      TriggerSchedulesBadRequestCodes.INVALID_SANDBOX_PROFILE_VERSION_REFERENCE,
      `Sandbox profile '${input.sandboxProfileId}' does not have an active version.`,
    );
  }

  const version = await ctx.db.query.sandboxProfileVersions.findFirst({
    columns: {
      version: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.sandboxProfileId, input.sandboxProfileId), eq(table.version, resolvedVersion)),
  });

  if (version === undefined) {
    throw new BadRequestError(
      TriggerSchedulesBadRequestCodes.INVALID_SANDBOX_PROFILE_VERSION_REFERENCE,
      `Sandbox profile version '${String(resolvedVersion)}' was not found.`,
    );
  }

  return resolvedVersion;
}

export async function assertPrimaryRepositoryReferenceOrThrow(
  ctx: {
    db: Parameters<typeof listProfileVersionRepositoryOptions>[0]["db"];
  },
  input: {
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    primaryRepositoryId: string | null;
  },
): Promise<void> {
  if (input.primaryRepositoryId === null) {
    return;
  }

  const repositoryOptions = await listProfileVersionRepositoryOptions(
    {
      db: ctx.db,
    },
    {
      organizationId: input.organizationId,
      profileId: input.sandboxProfileId,
      profileVersion: input.sandboxProfileVersion,
    },
  );

  const matchingRepository = repositoryOptions.find(
    (option) => option.id === input.primaryRepositoryId,
  );
  if (matchingRepository !== undefined) {
    return;
  }

  throw new BadRequestError(
    TriggerSchedulesBadRequestCodes.INVALID_PRIMARY_REPOSITORY,
    `Primary repository '${input.primaryRepositoryId}' is not available for sandbox profile '${input.sandboxProfileId}' version ${String(input.sandboxProfileVersion)}.`,
  );
}
