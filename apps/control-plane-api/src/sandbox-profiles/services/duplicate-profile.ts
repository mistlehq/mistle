import {
  getControlPlaneDatabaseSchema,
  type IntegrationBindingKind,
  IntegrationConnectionStatuses,
  type ControlPlaneTables,
  type ControlPlaneTransaction,
  type SandboxProfile,
  type SandboxProfileVersionAgentRuntimeId,
  type SandboxProfileVersionDefaultPersistenceMode,
  SandboxProfileStatuses,
  type SandboxProfileVersionState,
  SandboxProfileVersionStates,
  ScheduleKinds,
  ScheduleTargetTypes,
  TriggerKinds,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import { findNextScheduleOccurrence } from "@mistle/time";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";

import { assertPrimaryRepositoryReferenceOrThrow as assertSchedulePrimaryRepositoryReferenceOrThrow } from "../../trigger-schedules/services/validation.js";
import { resolveNextScheduledAtOrThrow } from "../../trigger-schedules/services/validation.js";
import { assertPrimaryRepositoryReferenceOrThrow as assertWebhookPrimaryRepositoryReferenceOrThrow } from "../../trigger-webhooks/services/assert-primary-repository-reference-or-throw.js";
import { resolveSandboxProfileTriggerReferenceOrThrow } from "../../trigger-webhooks/services/assert-sandbox-profile-trigger-reference-or-throw.js";
import { assertWebhookSourceReferenceOrThrow } from "../../trigger-webhooks/services/assert-webhook-source-reference-or-throw.js";
import { assertWebhookTriggerRequirementsOrThrow } from "../../trigger-webhooks/services/assert-webhook-trigger-requirements-or-throw.js";
import {
  SandboxProfilesBadRequestCodes,
  SandboxProfilesConflictCodes,
  SandboxProfilesConflictError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

const DUPLICATED_ACTIVE_VERSION = 1;
const DUPLICATED_DRAFT_VERSION = 2;

type DuplicateProfileInput = {
  organizationId: string;
  sourceProfileId: string;
  displayName: string;
  includeTriggers: boolean;
  now: Date;
};

type DuplicateProfileOutput = {
  profile: SandboxProfile;
  activeVersion: number;
  draftVersion: number | null;
  duplicatedTriggerCount: number;
};

type SourceProfileVersion = {
  sandboxProfileId: string;
  version: number;
  state: SandboxProfileVersionState;
  publishedAt: string | null;
  snapshotImageProvider: string | null;
  snapshotImageId: string | null;
  setupScript: string | null;
  maintenanceScript: string | null;
  defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceMode;
  sandboxProvider: string | null;
  sandboxConnectionId: string | null;
  sandboxVcpuCount: number | null;
  sandboxMemoryMb: number | null;
  sandboxStorageMb: number | null;
  agentRuntimeId: SandboxProfileVersionAgentRuntimeId;
  gitCommitSigningIntegrationConnectionId: string | null;
  mistleMcpEnabled: boolean;
  mistleMcpApiKeyId: string | null;
};

type SourceIntegrationBinding = {
  connectionId: string;
  kind: IntegrationBindingKind;
  config: Record<string, unknown>;
};

export async function duplicateProfile(
  {
    db,
    integrationRegistry,
  }: Pick<CreateSandboxProfilesServiceInput, "db" | "integrationRegistry">,
  input: DuplicateProfileInput,
): Promise<DuplicateProfileOutput> {
  return await db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);
    const sourceProfile = await loadSourceProfileOrThrow(tx, input);
    const activeVersion = await loadUsableActiveVersionOrThrow(tx, {
      sourceProfileId: input.sourceProfileId,
      activeVersion: sourceProfile.activeVersion,
    });
    const draftVersion = await loadSourceDraftVersion(tx, {
      sourceProfileId: input.sourceProfileId,
    });

    await assertVersionReferencesAreValid(tx, tables, {
      organizationId: input.organizationId,
      now: input.now,
      versions: draftVersion === null ? [activeVersion] : [activeVersion, draftVersion],
    });

    const [createdProfile] = await tx
      .insert(tables.sandboxProfiles)
      .values({
        organizationId: input.organizationId,
        displayName: input.displayName,
        activeVersion: DUPLICATED_ACTIVE_VERSION,
        status: SandboxProfileStatuses.ACTIVE,
      })
      .returning();

    if (createdProfile === undefined) {
      throw new Error("Failed to create duplicated sandbox profile.");
    }

    await insertDuplicatedVersion(tx, tables, {
      profileId: createdProfile.id,
      version: DUPLICATED_ACTIVE_VERSION,
      state: SandboxProfileVersionStates.PUBLISHED,
      source: activeVersion,
      copySnapshot: true,
    });
    await copyVersionBindings(tx, tables, {
      sourceProfileId: input.sourceProfileId,
      sourceVersion: activeVersion.version,
      targetProfileId: createdProfile.id,
      targetVersion: DUPLICATED_ACTIVE_VERSION,
    });
    await copyAutomaticSnapshotRefresh(tx, tables, {
      organizationId: input.organizationId,
      sourceProfileId: input.sourceProfileId,
      sourceVersion: activeVersion.version,
      targetProfileId: createdProfile.id,
      targetVersion: DUPLICATED_ACTIVE_VERSION,
      now: input.now,
    });

    if (draftVersion !== null) {
      await insertDuplicatedVersion(tx, tables, {
        profileId: createdProfile.id,
        version: DUPLICATED_DRAFT_VERSION,
        state: SandboxProfileVersionStates.DRAFT,
        source: draftVersion,
        copySnapshot: false,
      });
      await copyVersionBindings(tx, tables, {
        sourceProfileId: input.sourceProfileId,
        sourceVersion: draftVersion.version,
        targetProfileId: createdProfile.id,
        targetVersion: DUPLICATED_DRAFT_VERSION,
      });
    }

    const duplicatedTriggerCount = input.includeTriggers
      ? await copyMatchingTriggers(tx, tables, {
          integrationRegistry,
          organizationId: input.organizationId,
          sourceProfileId: input.sourceProfileId,
          sourceVersion: activeVersion.version,
          targetProfileId: createdProfile.id,
          targetVersion: DUPLICATED_ACTIVE_VERSION,
          now: input.now,
        })
      : 0;

    return {
      profile: createdProfile,
      activeVersion: DUPLICATED_ACTIVE_VERSION,
      draftVersion: draftVersion === null ? null : DUPLICATED_DRAFT_VERSION,
      duplicatedTriggerCount,
    };
  });
}

async function loadSourceProfileOrThrow(
  tx: ControlPlaneTransaction,
  input: Pick<DuplicateProfileInput, "organizationId" | "sourceProfileId">,
): Promise<{ id: string; activeVersion: number | null }> {
  const sourceProfile = await tx.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
      activeVersion: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.sourceProfileId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });

  if (sourceProfile === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
      "Sandbox profile was not found.",
    );
  }

  return sourceProfile;
}

async function loadUsableActiveVersionOrThrow(
  tx: ControlPlaneTransaction,
  input: {
    sourceProfileId: string;
    activeVersion: number | null;
  },
): Promise<SourceProfileVersion> {
  if (input.activeVersion === null) {
    throw new SandboxProfilesConflictError(
      SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_USABLE,
      "Sandbox profile must have a usable active version before it can be duplicated.",
    );
  }
  const sourceActiveVersion = input.activeVersion;

  const activeVersion = await tx.query.sandboxProfileVersions.findFirst({
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.sandboxProfileId, input.sourceProfileId),
        whereEq(table.version, sourceActiveVersion),
      ),
  });

  if (activeVersion === undefined) {
    throw new SandboxProfilesConflictError(
      SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_USABLE,
      `Active sandbox profile version '${String(input.activeVersion)}' was not found.`,
    );
  }

  if (
    activeVersion.state !== SandboxProfileVersionStates.PUBLISHED ||
    activeVersion.snapshotImageProvider === null ||
    activeVersion.snapshotImageId === null
  ) {
    throw new SandboxProfilesConflictError(
      SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_USABLE,
      "Sandbox profile must have a usable active version before it can be duplicated.",
    );
  }

  return activeVersion;
}

async function loadSourceDraftVersion(
  tx: ControlPlaneTransaction,
  input: {
    sourceProfileId: string;
  },
): Promise<SourceProfileVersion | null> {
  const draftVersion =
    (await tx.query.sandboxProfileVersions.findFirst({
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(
          whereEq(table.sandboxProfileId, input.sourceProfileId),
          whereEq(table.state, SandboxProfileVersionStates.DRAFT),
        ),
    })) ?? null;

  return draftVersion;
}

async function assertVersionReferencesAreValid(
  tx: ControlPlaneTransaction,
  tables: ControlPlaneTables,
  input: {
    organizationId: string;
    now: Date;
    versions: readonly SourceProfileVersion[];
  },
): Promise<void> {
  const connectionIds = new Set<string>();
  const apiKeyIds = new Set<string>();

  for (const version of input.versions) {
    if (version.sandboxConnectionId !== null) {
      connectionIds.add(version.sandboxConnectionId);
    }
    if (version.gitCommitSigningIntegrationConnectionId !== null) {
      connectionIds.add(version.gitCommitSigningIntegrationConnectionId);
    }
    if (version.mistleMcpEnabled && version.mistleMcpApiKeyId !== null) {
      apiKeyIds.add(version.mistleMcpApiKeyId);
    }

    const bindings = await loadSourceIntegrationBindings(tx, {
      profileId: version.sandboxProfileId,
      version: version.version,
    });
    for (const binding of bindings) {
      connectionIds.add(binding.connectionId);
    }
  }

  for (const connectionId of connectionIds) {
    const connection = await tx.query.integrationConnections.findFirst({
      columns: {
        id: true,
      },
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(
          whereEq(table.id, connectionId),
          whereEq(table.organizationId, input.organizationId),
          whereEq(table.status, IntegrationConnectionStatuses.ACTIVE),
        ),
    });

    if (connection === undefined) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.INVALID_DUPLICATE_REFERENCE,
        `Sandbox profile duplicate references inactive or missing integration connection '${connectionId}'.`,
      );
    }
  }

  for (const apiKeyId of apiKeyIds) {
    const apiKey = await tx
      .select({
        id: tables.apiKeys.id,
      })
      .from(tables.apiKeys)
      .where(
        and(
          eq(tables.apiKeys.id, apiKeyId),
          eq(tables.apiKeys.organizationId, input.organizationId),
          isNull(tables.apiKeys.revokedAt),
          or(
            isNull(tables.apiKeys.expiresAt),
            gt(tables.apiKeys.expiresAt, input.now.toISOString()),
          ),
        ),
      )
      .limit(1);

    if (apiKey[0] === undefined) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.INVALID_DUPLICATE_REFERENCE,
        `Sandbox profile duplicate references unavailable API key '${apiKeyId}'.`,
      );
    }
  }
}

async function insertDuplicatedVersion(
  tx: ControlPlaneTransaction,
  tables: ControlPlaneTables,
  input: {
    profileId: string;
    version: number;
    state: typeof SandboxProfileVersionStates.PUBLISHED | typeof SandboxProfileVersionStates.DRAFT;
    source: SourceProfileVersion;
    copySnapshot: boolean;
  },
): Promise<void> {
  await tx.insert(tables.sandboxProfileVersions).values({
    sandboxProfileId: input.profileId,
    version: input.version,
    state: input.state,
    publishedAt: input.state === SandboxProfileVersionStates.PUBLISHED ? sql`now()` : null,
    snapshotImageProvider: input.copySnapshot ? input.source.snapshotImageProvider : null,
    snapshotImageId: input.copySnapshot ? input.source.snapshotImageId : null,
    setupScript: input.source.setupScript,
    maintenanceScript: input.source.maintenanceScript,
    defaultPersistenceMode: input.source.defaultPersistenceMode,
    sandboxProvider: input.source.sandboxProvider,
    sandboxConnectionId: input.source.sandboxConnectionId,
    sandboxVcpuCount: input.source.sandboxVcpuCount,
    sandboxMemoryMb: input.source.sandboxMemoryMb,
    sandboxStorageMb: input.source.sandboxStorageMb,
    agentRuntimeId: input.source.agentRuntimeId,
    gitCommitSigningIntegrationConnectionId: input.source.gitCommitSigningIntegrationConnectionId,
    mistleMcpEnabled: input.source.mistleMcpEnabled,
    mistleMcpApiKeyId: input.source.mistleMcpApiKeyId,
  });
}

async function loadSourceIntegrationBindings(
  tx: ControlPlaneTransaction,
  input: {
    profileId: string;
    version: number;
  },
): Promise<SourceIntegrationBinding[]> {
  return await tx.query.sandboxProfileVersionIntegrationBindings.findMany({
    columns: {
      connectionId: true,
      kind: true,
      config: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.sandboxProfileId, input.profileId),
        whereEq(table.sandboxProfileVersion, input.version),
      ),
    orderBy: (table, { asc }) => [asc(table.id)],
  });
}

async function copyVersionBindings(
  tx: ControlPlaneTransaction,
  tables: ControlPlaneTables,
  input: {
    sourceProfileId: string;
    sourceVersion: number;
    targetProfileId: string;
    targetVersion: number;
  },
): Promise<void> {
  const bindings = await loadSourceIntegrationBindings(tx, {
    profileId: input.sourceProfileId,
    version: input.sourceVersion,
  });

  if (bindings.length === 0) {
    return;
  }

  await tx.insert(tables.sandboxProfileVersionIntegrationBindings).values(
    bindings.map((binding) => ({
      sandboxProfileId: input.targetProfileId,
      sandboxProfileVersion: input.targetVersion,
      connectionId: binding.connectionId,
      kind: binding.kind,
      config: binding.config,
    })),
  );
}

async function copyAutomaticSnapshotRefresh(
  tx: ControlPlaneTransaction,
  tables: ControlPlaneTables,
  input: {
    organizationId: string;
    sourceProfileId: string;
    sourceVersion: number;
    targetProfileId: string;
    targetVersion: number;
    now: Date;
  },
): Promise<void> {
  const [sourceSchedule] = await tx
    .select({
      id: tables.schedules.id,
      name: tables.schedules.name,
      cronExpression: tables.schedules.cronExpression,
      timezone: tables.schedules.timezone,
    })
    .from(tables.sandboxProfileSnapshotRefreshScheduleTargets)
    .innerJoin(
      tables.schedules,
      eq(tables.schedules.id, tables.sandboxProfileSnapshotRefreshScheduleTargets.scheduleId),
    )
    .where(
      and(
        eq(
          tables.sandboxProfileSnapshotRefreshScheduleTargets.sandboxProfileId,
          input.sourceProfileId,
        ),
        eq(
          tables.sandboxProfileSnapshotRefreshScheduleTargets.sandboxProfileVersion,
          input.sourceVersion,
        ),
        eq(tables.schedules.kind, ScheduleKinds.RECURRING),
        eq(tables.schedules.enabled, true),
        isNull(tables.schedules.deletedAt),
      ),
    )
    .limit(1);

  if (sourceSchedule === undefined) {
    return;
  }

  if (sourceSchedule.cronExpression === null || sourceSchedule.timezone === null) {
    throw new Error(`Snapshot refresh schedule '${sourceSchedule.id}' is missing timing fields.`);
  }

  const occurrence = findNextScheduleOccurrence({
    after: input.now,
    cronExpression: sourceSchedule.cronExpression,
    timezone: sourceSchedule.timezone,
  });

  if (occurrence === null) {
    throw new BadRequestError(
      SandboxProfilesBadRequestCodes.INVALID_REFRESH_SCHEDULE,
      `Snapshot refresh schedule '${sourceSchedule.id}' has no next occurrence.`,
    );
  }

  const [createdSchedule] = await tx
    .insert(tables.schedules)
    .values({
      organizationId: input.organizationId,
      targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
      kind: ScheduleKinds.RECURRING,
      name: sourceSchedule.name,
      cronExpression: sourceSchedule.cronExpression,
      timezone: sourceSchedule.timezone,
      enabled: true,
      nextScheduledAt: occurrence.scheduledAt.toISOString(),
    })
    .returning({
      id: tables.schedules.id,
    });

  if (createdSchedule === undefined) {
    throw new Error("Expected duplicated snapshot refresh schedule to be created.");
  }

  await tx.insert(tables.sandboxProfileSnapshotRefreshScheduleTargets).values({
    scheduleId: createdSchedule.id,
    sandboxProfileId: input.targetProfileId,
    sandboxProfileVersion: input.targetVersion,
  });
}

async function copyMatchingTriggers(
  tx: ControlPlaneTransaction,
  tables: ControlPlaneTables,
  input: Pick<CreateSandboxProfilesServiceInput, "integrationRegistry"> & {
    organizationId: string;
    sourceProfileId: string;
    sourceVersion: number;
    targetProfileId: string;
    targetVersion: number;
    now: Date;
  },
): Promise<number> {
  const sourceTargets = await tx.query.triggerTargets.findMany({
    columns: {
      id: true,
      triggerId: true,
      primaryRepositoryId: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.sandboxProfileId, input.sourceProfileId),
        whereEq(table.sandboxProfileVersion, input.sourceVersion),
      ),
    orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
  });

  let copiedCount = 0;
  for (const sourceTarget of sourceTargets) {
    const trigger = await tx.query.triggers.findFirst({
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(
          whereEq(table.id, sourceTarget.triggerId),
          whereEq(table.organizationId, input.organizationId),
        ),
    });

    if (trigger === undefined) {
      throw new Error(`Trigger '${sourceTarget.triggerId}' was not found.`);
    }

    switch (trigger.kind) {
      case TriggerKinds.WEBHOOK:
        await copyWebhookTrigger(tx, tables, input, {
          sourceTarget,
          trigger,
        });
        copiedCount += 1;
        break;
      case TriggerKinds.SCHEDULE: {
        const didCopy = await copyRecurringScheduleTrigger(tx, tables, input, {
          sourceTarget,
          trigger,
        });
        if (didCopy) {
          copiedCount += 1;
        }
        break;
      }
    }
  }

  return copiedCount;
}

async function copyWebhookTrigger(
  tx: ControlPlaneTransaction,
  tables: ControlPlaneTables,
  input: Pick<CreateSandboxProfilesServiceInput, "integrationRegistry"> & {
    organizationId: string;
    targetProfileId: string;
    targetVersion: number;
  },
  source: {
    sourceTarget: {
      primaryRepositoryId: string | null;
    };
    trigger: {
      id: string;
      name: string;
    };
  },
): Promise<void> {
  const webhookTrigger = await tx.query.webhookTriggers.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.triggerId, source.trigger.id),
  });

  if (webhookTrigger === undefined) {
    throw new Error(`Webhook trigger '${source.trigger.id}' config was not found.`);
  }

  const resolvedWebhookSource = await assertWebhookSourceReferenceOrThrow(
    {
      db: tx,
      integrationRegistry: input.integrationRegistry,
    },
    {
      organizationId: input.organizationId,
      integrationWebhookSourceId: webhookTrigger.integrationWebhookSourceId,
    },
  );
  assertWebhookTriggerRequirementsOrThrow({
    eventTypes: webhookTrigger.eventTypes,
    providerMetadata: resolvedWebhookSource.providerMetadata,
    supportedWebhookEvents: resolvedWebhookSource.supportedWebhookEvents,
  });
  await resolveSandboxProfileTriggerReferenceOrThrow(
    {
      db: tx,
    },
    {
      sandboxProfileId: input.targetProfileId,
      sandboxProfileVersion: input.targetVersion,
      integrationConnectionId: resolvedWebhookSource.integrationConnectionId,
    },
  );
  await assertWebhookPrimaryRepositoryReferenceOrThrow(
    {
      db: tx,
    },
    {
      organizationId: input.organizationId,
      sandboxProfileId: input.targetProfileId,
      sandboxProfileVersion: input.targetVersion,
      primaryRepositoryId: source.sourceTarget.primaryRepositoryId,
    },
  );

  const [createdTrigger] = await tx
    .insert(tables.triggers)
    .values({
      organizationId: input.organizationId,
      kind: TriggerKinds.WEBHOOK,
      name: `${source.trigger.name} copy`,
      enabled: false,
    })
    .returning({
      id: tables.triggers.id,
    });

  if (createdTrigger === undefined) {
    throw new Error("Expected duplicated webhook trigger to be created.");
  }

  await tx.insert(tables.webhookTriggers).values({
    triggerId: createdTrigger.id,
    integrationWebhookSourceId: webhookTrigger.integrationWebhookSourceId,
    eventTypes: webhookTrigger.eventTypes,
    payloadFilter: webhookTrigger.payloadFilter,
    inputTemplate: webhookTrigger.inputTemplate,
    instructions: webhookTrigger.instructions,
    conversationKeyTemplate: webhookTrigger.conversationKeyTemplate,
    idempotencyKeyTemplate: webhookTrigger.idempotencyKeyTemplate,
  });
  await tx.insert(tables.triggerTargets).values({
    triggerId: createdTrigger.id,
    sandboxProfileId: input.targetProfileId,
    sandboxProfileVersion: input.targetVersion,
    primaryRepositoryId: source.sourceTarget.primaryRepositoryId,
  });
}

async function copyRecurringScheduleTrigger(
  tx: ControlPlaneTransaction,
  tables: ControlPlaneTables,
  input: {
    organizationId: string;
    targetProfileId: string;
    targetVersion: number;
    now: Date;
  },
  source: {
    sourceTarget: {
      primaryRepositoryId: string | null;
    };
    trigger: {
      id: string;
      name: string;
    };
  },
): Promise<boolean> {
  const scheduleTrigger = await tx.query.scheduleTriggers.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.triggerId, source.trigger.id),
  });

  if (scheduleTrigger === undefined) {
    throw new Error(`Scheduled trigger '${source.trigger.id}' config was not found.`);
  }

  const schedule = await tx.query.schedules.findFirst({
    where: (table, { and: whereAnd, eq: whereEq, isNull: whereIsNull }) =>
      whereAnd(whereEq(table.id, scheduleTrigger.scheduleId), whereIsNull(table.deletedAt)),
  });

  if (schedule === undefined) {
    return false;
  }
  if (schedule.kind === ScheduleKinds.ONE_OFF) {
    return false;
  }
  if (schedule.cronExpression === null || schedule.timezone === null) {
    throw new Error(`Recurring trigger schedule '${schedule.id}' is missing timing fields.`);
  }

  resolveNextScheduledAtOrThrow({
    cronExpression: schedule.cronExpression,
    timezone: schedule.timezone,
    now: input.now,
  });
  await assertSchedulePrimaryRepositoryReferenceOrThrow(
    {
      db: tx,
    },
    {
      organizationId: input.organizationId,
      sandboxProfileId: input.targetProfileId,
      sandboxProfileVersion: input.targetVersion,
      primaryRepositoryId: source.sourceTarget.primaryRepositoryId,
    },
  );

  const [createdTrigger] = await tx
    .insert(tables.triggers)
    .values({
      organizationId: input.organizationId,
      kind: TriggerKinds.SCHEDULE,
      name: `${source.trigger.name} copy`,
      enabled: false,
    })
    .returning({
      id: tables.triggers.id,
    });

  if (createdTrigger === undefined) {
    throw new Error("Expected duplicated scheduled trigger to be created.");
  }

  const [createdSchedule] = await tx
    .insert(tables.schedules)
    .values({
      organizationId: input.organizationId,
      targetType: ScheduleTargetTypes.TRIGGER_RUN,
      kind: ScheduleKinds.RECURRING,
      name: schedule.name,
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone,
      enabled: false,
      nextScheduledAt: null,
    })
    .returning({
      id: tables.schedules.id,
    });

  if (createdSchedule === undefined) {
    throw new Error("Expected duplicated trigger schedule to be created.");
  }

  await tx.insert(tables.scheduleTriggers).values({
    scheduleId: createdSchedule.id,
    triggerId: createdTrigger.id,
    inputTemplate: scheduleTrigger.inputTemplate,
    conversationKeyTemplate: scheduleTrigger.conversationKeyTemplate,
    idempotencyKeyTemplate: scheduleTrigger.idempotencyKeyTemplate,
  });
  await tx.insert(tables.triggerTargets).values({
    triggerId: createdTrigger.id,
    sandboxProfileId: input.targetProfileId,
    sandboxProfileVersion: input.targetVersion,
    primaryRepositoryId: source.sourceTarget.primaryRepositoryId,
  });

  return true;
}
