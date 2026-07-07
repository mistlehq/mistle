import {
  SandboxOperationKinds,
  SandboxInstancePurposes,
  SandboxInstanceStatuses,
  SandboxStopReasons,
  SandboxUsageEventTypes,
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstanceStatus,
  type SandboxInstanceProvider,
  type SandboxInstancePurpose,
} from "@mistle/db/data-plane";
import { CompiledRuntimePlanSchema } from "@mistle/integrations-core";
import {
  isSandboxResourceNotFoundError,
  SandboxInspectStates,
  type SandboxAdapter,
} from "@mistle/sandbox";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type { AppRuntimeResources } from "../../../resources.js";
import { assertRuntimeSandboxProvider } from "../../../sandbox/adapter.js";
import { resolveSandboxRuntimeAdapter } from "../../../sandbox/runtime-provider-resolver.js";
import type { DataPlaneApiRuntimeConfig } from "../../../types.js";
import type {
  GetSandboxInstanceInput,
  GetSandboxInstanceResponse,
} from "../get-sandbox-instance/schema.js";
import { readEffectiveSandboxStatus } from "./read-effective-sandbox-status.js";
import {
  determineStartingSandboxInspectionOutcome,
  StartingSandboxInspectionOutcomes,
} from "./starting-sandbox-inspection-policy.js";
import { isStoppedSandboxProviderDispositionRecoverable } from "./stopped-sandbox-inspection-policy.js";

type GetSandboxInstanceContext = {
  config: DataPlaneApiRuntimeConfig;
  controlPlaneInternalClient: AppRuntimeResources["controlPlaneInternalClient"];
  db: DataPlaneDatabase;
  tables: Pick<DataPlaneTables, "sandboxInstances" | "sandboxUsageEvents">;
  runtimeStateReader: AppRuntimeResources["runtimeStateReader"];
};

const DefaultReadableSandboxInstancePurposes: readonly SandboxInstancePurpose[] = [
  SandboxInstancePurposes.SESSION,
  SandboxInstancePurposes.SETUP_ASSISTANT,
  SandboxInstancePurposes.SETUP_CHECK,
  SandboxInstancePurposes.SKILLS_DISCOVERY,
];

type SandboxInstanceRuntimeSelection = {
  organizationId: string;
  runtimeProvider: SandboxInstanceProvider;
  sandboxConnectionId: string | null;
  computeGeneration: number;
  sandboxVcpuCount: number | null;
  sandboxMemoryMb: number | null;
  sandboxDiskMb: number | null;
};

type InspectableSandboxInstance = SandboxInstanceRuntimeSelection & {
  id: string;
  title: string | null;
  providerSandboxId: string | null;
  status: SandboxInstanceStatus;
  failureCode: string | null;
  failureMessage: string | null;
  runtimePlan: PersistedRuntimePlan;
};

async function readPersistedRuntimePlan(input: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
}) {
  const persistedRuntimePlan = await input.db.query.sandboxInstanceRuntimePlans.findFirst({
    columns: {
      compiledRuntimePlan: true,
    },
    where: (table, { and, eq, isNull }) =>
      and(eq(table.sandboxInstanceId, input.sandboxInstanceId), isNull(table.supersededAt)),
  });

  if (persistedRuntimePlan === undefined) {
    return null;
  }

  return CompiledRuntimePlanSchema.parse(persistedRuntimePlan.compiledRuntimePlan);
}

type PersistedRuntimePlan = Awaited<ReturnType<typeof readPersistedRuntimePlan>>;
type SandboxInstanceInspectionResponse = Omit<
  NonNullable<GetSandboxInstanceResponse>,
  "sandboxProfileId" | "sandboxProfileVersion"
>;

const StartupInspectionStatuses: SandboxInstanceStatus[] = [
  SandboxInstanceStatuses.STARTING,
  SandboxInstanceStatuses.STARTED,
  SandboxInstanceStatuses.INITIALIZING,
];

const RuntimeInspectionStatuses: SandboxInstanceStatus[] = [
  SandboxInstanceStatuses.RUNNING,
  SandboxInstanceStatuses.DEGRADED,
  SandboxInstanceStatuses.RECONNECTING,
];

async function readLatestStartupOperation(input: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
}): Promise<NonNullable<NonNullable<GetSandboxInstanceResponse>["startupOperation"]> | null> {
  const operationEvent = await input.db.query.sandboxOperationEvents.findFirst({
    columns: {
      operationId: true,
      operationKind: true,
    },
    where: (table, { and, eq, or }) =>
      and(
        eq(table.sandboxInstanceId, input.sandboxInstanceId),
        or(
          eq(table.operationKind, SandboxOperationKinds.START),
          eq(table.operationKind, SandboxOperationKinds.RESUME),
        ),
      ),
    orderBy: (table, { desc }) => [desc(table.createdAt), desc(table.sequence)],
  });

  if (operationEvent === undefined) {
    return null;
  }

  if (
    operationEvent.operationKind !== SandboxOperationKinds.START &&
    operationEvent.operationKind !== SandboxOperationKinds.RESUME
  ) {
    throw new Error("Expected latest sandbox startup operation to be start or resume.");
  }

  return {
    operationId: operationEvent.operationId,
    operationKind: operationEvent.operationKind,
  };
}

async function markRunningSandboxInstanceStopped(
  ctx: Pick<GetSandboxInstanceContext, "db" | "tables">,
  input: SandboxInstanceRuntimeSelection & {
    sandboxInstanceId: string;
    providerSandboxId: string;
    clearProviderSandboxId?: boolean;
  },
): Promise<void> {
  const { sandboxInstances } = ctx.tables;

  await ctx.db.transaction(async (tx) => {
    const updatedRows = await tx
      .update(sandboxInstances)
      .set({
        status: SandboxInstanceStatuses.STOPPED,
        ...(input.clearProviderSandboxId === true ? { providerSandboxId: null } : {}),
        stoppedAt: sql`now()`,
        stopReason: SandboxStopReasons.SYSTEM,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(sandboxInstances.id, input.sandboxInstanceId),
          inArray(sandboxInstances.status, RuntimeInspectionStatuses),
        ),
      )
      .returning({
        status: sandboxInstances.status,
        stoppedAt: sandboxInstances.stoppedAt,
      });

    const updatedRow = updatedRows[0];
    if (updatedRow?.status !== SandboxInstanceStatuses.STOPPED) {
      throw new Error(
        "Failed to transition sandbox instance status from runtime-active to stopped.",
      );
    }

    await recordInspectionTerminalSandboxUsageEvent(
      {
        db: tx,
        tables: ctx.tables,
      },
      {
        ...input,
        eventType: SandboxUsageEventTypes.SANDBOX_STOPPED,
        occurredAt: requireInspectionTerminalTimestamp(
          updatedRow.stoppedAt,
          "Expected stopped sandbox instance transition to return stoppedAt.",
        ),
        outcome: "stopped",
      },
    );
  });
}

function createInspectionSandboxUsageEventIdempotencyKey(input: {
  sandboxInstanceId: string;
  computeGeneration: number;
  eventType:
    | typeof SandboxUsageEventTypes.SANDBOX_STOPPED
    | typeof SandboxUsageEventTypes.SANDBOX_FAILED;
}): string {
  return [
    "usage",
    input.sandboxInstanceId,
    String(input.computeGeneration),
    input.eventType,
    "data-plane-api-inspection",
  ].join(":");
}

async function recordInspectionTerminalSandboxUsageEvent(
  ctx: {
    db: Pick<DataPlaneDatabase, "insert">;
    tables: Pick<DataPlaneTables, "sandboxUsageEvents">;
  },
  input: SandboxInstanceRuntimeSelection & {
    sandboxInstanceId: string;
    providerSandboxId: string | null;
    eventType:
      | typeof SandboxUsageEventTypes.SANDBOX_STOPPED
      | typeof SandboxUsageEventTypes.SANDBOX_FAILED;
    occurredAt: string;
    outcome: "stopped" | "failed";
  },
): Promise<void> {
  await ctx.db
    .insert(ctx.tables.sandboxUsageEvents)
    .values({
      idempotencyKey: createInspectionSandboxUsageEventIdempotencyKey({
        sandboxInstanceId: input.sandboxInstanceId,
        computeGeneration: input.computeGeneration,
        eventType: input.eventType,
      }),
      organizationId: input.organizationId,
      sandboxInstanceId: input.sandboxInstanceId,
      computeGeneration: input.computeGeneration,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      runtimeProvider: input.runtimeProvider,
      providerSandboxId: input.providerSandboxId,
      vcpuCount: input.sandboxVcpuCount,
      memoryMb: input.sandboxMemoryMb,
      diskMb: input.sandboxDiskMb,
      payload: {
        operationKind: "inspection",
        outcome: input.outcome,
      },
    })
    .onConflictDoNothing({
      target: ctx.tables.sandboxUsageEvents.idempotencyKey,
    });
}

function requireInspectionTerminalTimestamp(value: string | null, message: string): string {
  if (value === null) {
    throw new Error(message);
  }

  return value;
}

const InspectionFailureCodes = {
  PROVIDER_RUNTIME_MISSING: "provider_runtime_missing",
} as const;

async function markStartingSandboxInstanceFailed(
  ctx: Pick<GetSandboxInstanceContext, "db" | "tables">,
  input: SandboxInstanceRuntimeSelection & {
    sandboxInstanceId: string;
    providerSandboxId: string;
    failureCode: string;
    failureMessage: string;
  },
): Promise<void> {
  const { sandboxInstances } = ctx.tables;

  await ctx.db.transaction(async (tx) => {
    const updatedRows = await tx
      .update(sandboxInstances)
      .set({
        status: SandboxInstanceStatuses.FAILED,
        stopReason: SandboxStopReasons.FAILED,
        failedAt: sql`now()`,
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(sandboxInstances.id, input.sandboxInstanceId),
          inArray(sandboxInstances.status, StartupInspectionStatuses),
        ),
      )
      .returning({
        status: sandboxInstances.status,
        failedAt: sandboxInstances.failedAt,
      });

    const updatedRow = updatedRows[0];
    if (updatedRow?.status !== SandboxInstanceStatuses.FAILED) {
      throw new Error(
        "Failed to transition sandbox instance status from startup-active to failed.",
      );
    }

    await recordInspectionTerminalSandboxUsageEvent(
      {
        db: tx,
        tables: ctx.tables,
      },
      {
        ...input,
        eventType: SandboxUsageEventTypes.SANDBOX_FAILED,
        occurredAt: requireInspectionTerminalTimestamp(
          updatedRow.failedAt,
          "Expected failed sandbox instance transition to return failedAt.",
        ),
        outcome: "failed",
      },
    );
  });
}

async function markRunningSandboxInstanceFailed(
  ctx: Pick<GetSandboxInstanceContext, "db" | "tables">,
  input: SandboxInstanceRuntimeSelection & {
    sandboxInstanceId: string;
    providerSandboxId: string;
    failureCode: string;
    failureMessage: string;
  },
): Promise<void> {
  const { sandboxInstances } = ctx.tables;

  await ctx.db.transaction(async (tx) => {
    const updatedRows = await tx
      .update(sandboxInstances)
      .set({
        status: SandboxInstanceStatuses.FAILED,
        stopReason: SandboxStopReasons.FAILED,
        failedAt: sql`now()`,
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(sandboxInstances.id, input.sandboxInstanceId),
          inArray(sandboxInstances.status, RuntimeInspectionStatuses),
        ),
      )
      .returning({
        status: sandboxInstances.status,
        failedAt: sandboxInstances.failedAt,
      });

    const updatedRow = updatedRows[0];
    if (updatedRow?.status !== SandboxInstanceStatuses.FAILED) {
      throw new Error(
        "Failed to transition sandbox instance status from runtime-active to failed.",
      );
    }

    await recordInspectionTerminalSandboxUsageEvent(
      {
        db: tx,
        tables: ctx.tables,
      },
      {
        ...input,
        eventType: SandboxUsageEventTypes.SANDBOX_FAILED,
        occurredAt: requireInspectionTerminalTimestamp(
          updatedRow.failedAt,
          "Expected failed sandbox instance transition to return failedAt.",
        ),
        outcome: "failed",
      },
    );
  });
}

async function markStoppedSandboxInstanceFailed(
  ctx: Pick<GetSandboxInstanceContext, "db" | "tables">,
  input: SandboxInstanceRuntimeSelection & {
    sandboxInstanceId: string;
    providerSandboxId: string;
    failureCode: string;
    failureMessage: string;
  },
): Promise<void> {
  const { sandboxInstances } = ctx.tables;

  await ctx.db.transaction(async (tx) => {
    const [lockedRow] = await tx
      .select({
        stoppedAt: sandboxInstances.stoppedAt,
      })
      .from(sandboxInstances)
      .where(
        and(
          eq(sandboxInstances.id, input.sandboxInstanceId),
          eq(sandboxInstances.status, SandboxInstanceStatuses.STOPPED),
        ),
      )
      .for("update");

    if (lockedRow === undefined) {
      throw new Error("Failed to transition sandbox instance status from stopped to failed.");
    }

    const stoppedAt = requireInspectionTerminalTimestamp(
      lockedRow.stoppedAt,
      "Expected stopped sandbox instance to have stoppedAt before inspection failure repair.",
    );

    const updatedRows = await tx
      .update(sandboxInstances)
      .set({
        status: SandboxInstanceStatuses.FAILED,
        stopReason: SandboxStopReasons.FAILED,
        failedAt: sql`now()`,
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(sandboxInstances.id, input.sandboxInstanceId),
          eq(sandboxInstances.status, SandboxInstanceStatuses.STOPPED),
        ),
      )
      .returning({
        status: sandboxInstances.status,
        failedAt: sandboxInstances.failedAt,
      });

    const updatedRow = updatedRows[0];
    if (updatedRow?.status !== SandboxInstanceStatuses.FAILED) {
      throw new Error("Failed to transition sandbox instance status from stopped to failed.");
    }

    await recordInspectionTerminalSandboxUsageEvent(
      {
        db: tx,
        tables: ctx.tables,
      },
      {
        ...input,
        eventType: SandboxUsageEventTypes.SANDBOX_STOPPED,
        occurredAt: stoppedAt,
        outcome: "stopped",
      },
    );
  });
}

async function inspectStartingSandboxInstance(
  ctx: GetSandboxInstanceContext,
  sandboxInstance: InspectableSandboxInstance,
): Promise<SandboxInstanceInspectionResponse> {
  if (sandboxInstance.providerSandboxId === null) {
    if (sandboxInstance.status === SandboxInstanceStatuses.STARTING) {
      return {
        id: sandboxInstance.id,
        title: sandboxInstance.title,
        status: SandboxInstanceStatuses.STARTING,
        connectable: false,
        failureCode: sandboxInstance.failureCode,
        failureMessage: sandboxInstance.failureMessage,
        runtimePlan: sandboxInstance.runtimePlan,
        startupOperation: null,
      };
    }

    throw new Error(
      `Expected ${sandboxInstance.status} sandbox instance '${sandboxInstance.id}' to have a providerSandboxId.`,
    );
  }

  const inspection = await inspectSandboxInstanceOrNull(
    ctx,
    sandboxInstance,
    sandboxInstance.providerSandboxId,
  );

  if (inspection === null) {
    await markStartingSandboxInstanceFailed(ctx, {
      ...sandboxInstance,
      sandboxInstanceId: sandboxInstance.id,
      providerSandboxId: sandboxInstance.providerSandboxId,
      failureCode: InspectionFailureCodes.PROVIDER_RUNTIME_MISSING,
      failureMessage: "Sandbox runtime was not found at the provider during startup inspection.",
    });
    return {
      id: sandboxInstance.id,
      title: sandboxInstance.title,
      status: SandboxInstanceStatuses.FAILED,
      connectable: false,
      failureCode: InspectionFailureCodes.PROVIDER_RUNTIME_MISSING,
      failureMessage: "Sandbox runtime was not found at the provider during startup inspection.",
      runtimePlan: sandboxInstance.runtimePlan,
      startupOperation: null,
    };
  }

  const dispositionOutcome = determineStartingSandboxInspectionOutcome({
    providerDisposition: inspection.disposition,
  });

  if (dispositionOutcome.kind === StartingSandboxInspectionOutcomes.KEEP_STARTING) {
    const status = await readEffectiveSandboxStatus(
      {
        runtimeStateReader: ctx.runtimeStateReader,
      },
      {
        sandboxInstanceId: sandboxInstance.id,
        persistedStatus: sandboxInstance.status,
      },
    );

    return {
      id: sandboxInstance.id,
      title: sandboxInstance.title,
      status,
      connectable: status === "running",
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
      runtimePlan: sandboxInstance.runtimePlan,
      startupOperation: null,
    };
  }

  await markStartingSandboxInstanceFailed(ctx, {
    ...sandboxInstance,
    sandboxInstanceId: sandboxInstance.id,
    providerSandboxId: sandboxInstance.providerSandboxId,
    failureCode: dispositionOutcome.failureCode,
    failureMessage: dispositionOutcome.failureMessage,
  });

  return {
    id: sandboxInstance.id,
    title: sandboxInstance.title,
    status: SandboxInstanceStatuses.FAILED,
    connectable: false,
    failureCode: dispositionOutcome.failureCode,
    failureMessage: dispositionOutcome.failureMessage,
    runtimePlan: sandboxInstance.runtimePlan,
    startupOperation: null,
  };
}

function readPendingSandboxInstance(sandboxInstance: {
  id: string;
  title: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  runtimePlan: PersistedRuntimePlan;
}): SandboxInstanceInspectionResponse {
  return {
    id: sandboxInstance.id,
    title: sandboxInstance.title,
    status: SandboxInstanceStatuses.PENDING,
    connectable: false,
    failureCode: sandboxInstance.failureCode,
    failureMessage: sandboxInstance.failureMessage,
    runtimePlan: sandboxInstance.runtimePlan,
    startupOperation: null,
  };
}

async function inspectStoppedSandboxInstance(
  ctx: GetSandboxInstanceContext,
  sandboxInstance: InspectableSandboxInstance,
): Promise<SandboxInstanceInspectionResponse> {
  if (sandboxInstance.providerSandboxId === null) {
    throw new Error(
      `Expected stopped sandbox instance '${sandboxInstance.id}' to have a providerSandboxId.`,
    );
  }

  const inspection = await inspectSandboxInstanceOrNull(
    ctx,
    sandboxInstance,
    sandboxInstance.providerSandboxId,
  );
  if (inspection === null) {
    await markStoppedSandboxInstanceFailed(ctx, {
      ...sandboxInstance,
      sandboxInstanceId: sandboxInstance.id,
      providerSandboxId: sandboxInstance.providerSandboxId,
      failureCode: InspectionFailureCodes.PROVIDER_RUNTIME_MISSING,
      failureMessage: "Sandbox runtime was not found at the provider during inspection.",
    });
    return {
      id: sandboxInstance.id,
      title: sandboxInstance.title,
      status: SandboxInstanceStatuses.FAILED,
      connectable: false,
      failureCode: InspectionFailureCodes.PROVIDER_RUNTIME_MISSING,
      failureMessage: "Sandbox runtime was not found at the provider during inspection.",
      runtimePlan: sandboxInstance.runtimePlan,
      startupOperation: null,
    };
  }

  if (isStoppedSandboxProviderDispositionRecoverable(inspection.disposition)) {
    return {
      id: sandboxInstance.id,
      title: sandboxInstance.title,
      status: SandboxInstanceStatuses.STOPPED,
      connectable: false,
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
      runtimePlan: sandboxInstance.runtimePlan,
      startupOperation: null,
    };
  }

  await markStoppedSandboxInstanceFailed(ctx, {
    ...sandboxInstance,
    sandboxInstanceId: sandboxInstance.id,
    providerSandboxId: sandboxInstance.providerSandboxId,
    failureCode: "provider_runtime_not_resumable",
    failureMessage: "Sandbox runtime was not resumable at the provider during inspection.",
  });
  return {
    id: sandboxInstance.id,
    title: sandboxInstance.title,
    status: SandboxInstanceStatuses.FAILED,
    connectable: false,
    failureCode: "provider_runtime_not_resumable",
    failureMessage: "Sandbox runtime was not resumable at the provider during inspection.",
    runtimePlan: sandboxInstance.runtimePlan,
    startupOperation: null,
  };
}

async function inspectRunningSandboxInstance(
  ctx: GetSandboxInstanceContext,
  sandboxInstance: InspectableSandboxInstance,
): Promise<SandboxInstanceInspectionResponse> {
  if (sandboxInstance.providerSandboxId === null) {
    throw new Error(
      `Expected running sandbox instance '${sandboxInstance.id}' to have a providerSandboxId.`,
    );
  }

  const inspection = await inspectSandboxInstanceOrNull(
    ctx,
    sandboxInstance,
    sandboxInstance.providerSandboxId,
  );
  if (inspection === null) {
    await markRunningSandboxInstanceFailed(ctx, {
      ...sandboxInstance,
      sandboxInstanceId: sandboxInstance.id,
      providerSandboxId: sandboxInstance.providerSandboxId,
      failureCode: InspectionFailureCodes.PROVIDER_RUNTIME_MISSING,
      failureMessage: "Sandbox runtime was not found at the provider during inspection.",
    });
    return {
      id: sandboxInstance.id,
      title: sandboxInstance.title,
      status: SandboxInstanceStatuses.FAILED,
      connectable: false,
      failureCode: InspectionFailureCodes.PROVIDER_RUNTIME_MISSING,
      failureMessage: "Sandbox runtime was not found at the provider during inspection.",
      runtimePlan: sandboxInstance.runtimePlan,
      startupOperation: null,
    };
  }

  if (inspection.state === SandboxInspectStates.RUNNING) {
    const status = await readEffectiveSandboxStatus(
      {
        runtimeStateReader: ctx.runtimeStateReader,
      },
      {
        sandboxInstanceId: sandboxInstance.id,
        persistedStatus: sandboxInstance.status,
      },
    );

    return {
      id: sandboxInstance.id,
      title: sandboxInstance.title,
      status,
      connectable: status === "running",
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
      runtimePlan: sandboxInstance.runtimePlan,
      startupOperation: null,
    };
  }

  await markRunningSandboxInstanceStopped(ctx, {
    ...sandboxInstance,
    sandboxInstanceId: sandboxInstance.id,
    providerSandboxId: sandboxInstance.providerSandboxId,
  });

  return {
    id: sandboxInstance.id,
    title: sandboxInstance.title,
    status: SandboxInstanceStatuses.STOPPED,
    connectable: false,
    failureCode: sandboxInstance.failureCode,
    failureMessage: sandboxInstance.failureMessage,
    runtimePlan: sandboxInstance.runtimePlan,
    startupOperation: null,
  };
}

async function inspectSandboxInstanceOrNull(
  ctx: GetSandboxInstanceContext,
  sandboxInstance: SandboxInstanceRuntimeSelection,
  providerSandboxId: string,
) {
  const sandboxAdapter = await resolvePersistedSandboxInstanceAdapter(ctx, sandboxInstance);

  try {
    return await sandboxAdapter.inspect({
      id: providerSandboxId,
    });
  } catch (error) {
    if (!isSandboxResourceNotFoundError(error)) {
      throw error;
    }

    return null;
  }
}

function createPersistedSandboxResources(input: SandboxInstanceRuntimeSelection):
  | {
      vcpuCount: number;
      memoryMb: number;
      diskMb?: number;
    }
  | undefined {
  if (
    input.sandboxVcpuCount === null &&
    input.sandboxMemoryMb === null &&
    input.sandboxDiskMb === null
  ) {
    return undefined;
  }

  if (input.sandboxVcpuCount === null || input.sandboxMemoryMb === null) {
    throw new Error("Persisted sandbox resources are incomplete.");
  }

  return {
    vcpuCount: input.sandboxVcpuCount,
    memoryMb: input.sandboxMemoryMb,
    ...(input.sandboxDiskMb === null ? {} : { diskMb: input.sandboxDiskMb }),
  };
}

async function resolvePersistedSandboxInstanceAdapter(
  ctx: Pick<GetSandboxInstanceContext, "config" | "controlPlaneInternalClient">,
  sandboxInstance: SandboxInstanceRuntimeSelection,
): Promise<SandboxAdapter> {
  const resources = createPersistedSandboxResources(sandboxInstance);

  return resolveSandboxRuntimeAdapter(
    {
      config: ctx.config,
      controlPlaneInternalClient: ctx.controlPlaneInternalClient,
    },
    {
      organizationId: sandboxInstance.organizationId,
      provider: sandboxInstance.runtimeProvider,
      ...(sandboxInstance.sandboxConnectionId === null
        ? {}
        : { connectionId: sandboxInstance.sandboxConnectionId }),
      ...(resources === undefined ? {} : { resources }),
    },
  );
}

export async function getSandboxInstance(
  ctx: GetSandboxInstanceContext,
  input: GetSandboxInstanceInput,
): Promise<GetSandboxInstanceResponse> {
  const allowedPurposes = input.allowedPurposes ?? DefaultReadableSandboxInstancePurposes;
  const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
    columns: {
      id: true,
      organizationId: true,
      sandboxProfileId: true,
      sandboxProfileVersion: true,
      title: true,
      runtimeProvider: true,
      sandboxConnectionId: true,
      computeGeneration: true,
      sandboxVcpuCount: true,
      sandboxMemoryMb: true,
      sandboxDiskMb: true,
      providerSandboxId: true,
      status: true,
      failureCode: true,
      failureMessage: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        eq(table.id, input.instanceId),
        whereEq(table.organizationId, input.organizationId),
        isNull(table.deletedAt),
        inArray(table.purpose, allowedPurposes),
      ),
  });
  if (sandboxInstance === undefined) {
    return null;
  }

  const runtimePlan = await readPersistedRuntimePlan({
    db: ctx.db,
    sandboxInstanceId: sandboxInstance.id,
  });

  assertRuntimeSandboxProvider(sandboxInstance.runtimeProvider);

  let response: SandboxInstanceInspectionResponse;
  switch (sandboxInstance.status) {
    case SandboxInstanceStatuses.FAILED: {
      response = {
        id: sandboxInstance.id,
        title: sandboxInstance.title,
        status: SandboxInstanceStatuses.FAILED,
        connectable: false,
        failureCode: sandboxInstance.failureCode,
        failureMessage: sandboxInstance.failureMessage,
        runtimePlan,
        startupOperation: null,
      };
      break;
    }
    case SandboxInstanceStatuses.STOPPED:
      response = await inspectStoppedSandboxInstance(ctx, {
        ...sandboxInstance,
        runtimePlan,
      });
      break;
    case SandboxInstanceStatuses.PENDING:
      response = readPendingSandboxInstance({
        ...sandboxInstance,
        runtimePlan,
      });
      break;
    case SandboxInstanceStatuses.STARTING: {
      response = await inspectStartingSandboxInstance(ctx, {
        ...sandboxInstance,
        runtimePlan,
      });
      break;
    }
    case SandboxInstanceStatuses.STARTED:
    case SandboxInstanceStatuses.INITIALIZING: {
      response = await inspectStartingSandboxInstance(ctx, {
        ...sandboxInstance,
        runtimePlan,
      });
      break;
    }
    case SandboxInstanceStatuses.RUNNING: {
      response = await inspectRunningSandboxInstance(ctx, {
        ...sandboxInstance,
        runtimePlan,
      });
      break;
    }
    case SandboxInstanceStatuses.DEGRADED:
    case SandboxInstanceStatuses.RECONNECTING: {
      response = await inspectRunningSandboxInstance(ctx, {
        ...sandboxInstance,
        runtimePlan,
      });
      break;
    }
    case SandboxInstanceStatuses.STOPPING: {
      response = {
        id: sandboxInstance.id,
        title: sandboxInstance.title,
        status: SandboxInstanceStatuses.STOPPING,
        connectable: false,
        failureCode: sandboxInstance.failureCode,
        failureMessage: sandboxInstance.failureMessage,
        runtimePlan,
        startupOperation: null,
      };
      break;
    }
    default:
      throw new Error("Unsupported sandbox instance status.");
  }

  return {
    ...response,
    sandboxProfileId: sandboxInstance.sandboxProfileId,
    sandboxProfileVersion: sandboxInstance.sandboxProfileVersion,
    startupOperation: await readLatestStartupOperation({
      db: ctx.db,
      sandboxInstanceId: sandboxInstance.id,
    }),
  };
}
