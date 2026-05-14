import {
  SandboxOperationKinds,
  SandboxInstancePersistenceModes,
  SandboxInstancePurposes,
  SandboxInstanceStatuses,
  SandboxStopReasons,
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstanceProvider,
} from "@mistle/db/data-plane";
import { CompiledRuntimePlanSchema } from "@mistle/integrations-core";
import {
  isSandboxResourceNotFoundError,
  SandboxInspectDispositions,
  SandboxInspectStates,
  type SandboxAdapter,
} from "@mistle/sandbox";
import { and, eq, or, sql } from "drizzle-orm";

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

type GetSandboxInstanceContext = {
  config: DataPlaneApiRuntimeConfig;
  controlPlaneInternalClient: AppRuntimeResources["controlPlaneInternalClient"];
  db: DataPlaneDatabase;
  tables: Pick<DataPlaneTables, "sandboxInstances">;
  runtimeStateReader: AppRuntimeResources["runtimeStateReader"];
};

type SandboxInstanceRuntimeSelection = {
  organizationId: string;
  runtimeProvider: SandboxInstanceProvider;
  sandboxConnectionId: string | null;
  sandboxVcpuCount: number | null;
  sandboxMemoryMb: number | null;
  sandboxStorageMb: number | null;
};

type InspectableSandboxInstance = SandboxInstanceRuntimeSelection & {
  id: string;
  title: string | null;
  persistenceMode: string;
  providerSandboxId: string | null;
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
  input: {
    sandboxInstanceId: string;
    clearProviderSandboxId?: boolean;
  },
): Promise<void> {
  const { sandboxInstances } = ctx.tables;

  const updatedRows = await ctx.db
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
        eq(sandboxInstances.status, SandboxInstanceStatuses.RUNNING),
      ),
    )
    .returning({
      status: sandboxInstances.status,
    });

  if (updatedRows[0]?.status === SandboxInstanceStatuses.STOPPED) {
    return;
  }

  throw new Error("Failed to transition sandbox instance status from running to stopped.");
}

async function clearStoppedSandboxInstanceProviderSandboxId(
  ctx: Pick<GetSandboxInstanceContext, "db" | "tables">,
  input: {
    sandboxInstanceId: string;
  },
): Promise<void> {
  const { sandboxInstances } = ctx.tables;

  const updatedRows = await ctx.db
    .update(sandboxInstances)
    .set({
      providerSandboxId: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sandboxInstances.id, input.sandboxInstanceId),
        eq(sandboxInstances.status, SandboxInstanceStatuses.STOPPED),
      ),
    )
    .returning({
      id: sandboxInstances.id,
    });

  if (updatedRows[0] !== undefined) {
    return;
  }

  throw new Error("Failed to clear provider sandbox id while sandbox instance remained stopped.");
}

const InspectionFailureCodes = {
  PROVIDER_RUNTIME_MISSING: "provider_runtime_missing",
} as const;

async function markStartingSandboxInstanceFailed(
  ctx: Pick<GetSandboxInstanceContext, "db" | "tables">,
  input: {
    sandboxInstanceId: string;
    failureCode: string;
    failureMessage: string;
  },
): Promise<void> {
  const { sandboxInstances } = ctx.tables;

  const updatedRows = await ctx.db
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
        eq(sandboxInstances.status, SandboxInstanceStatuses.STARTING),
      ),
    )
    .returning({
      status: sandboxInstances.status,
    });

  if (updatedRows[0]?.status === SandboxInstanceStatuses.FAILED) {
    return;
  }

  throw new Error("Failed to transition sandbox instance status from starting to failed.");
}

async function markStartingSandboxInstanceStopped(
  ctx: Pick<GetSandboxInstanceContext, "db" | "tables">,
  input: {
    sandboxInstanceId: string;
    clearProviderSandboxId?: boolean;
  },
): Promise<void> {
  const { sandboxInstances } = ctx.tables;

  const updatedRows = await ctx.db
    .update(sandboxInstances)
    .set({
      status: SandboxInstanceStatuses.STOPPED,
      ...(input.clearProviderSandboxId === true ? { providerSandboxId: null } : {}),
      stoppedAt: sql`now()`,
      stopReason: SandboxStopReasons.SYSTEM,
      failedAt: null,
      failureCode: null,
      failureMessage: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sandboxInstances.id, input.sandboxInstanceId),
        eq(sandboxInstances.status, SandboxInstanceStatuses.STARTING),
      ),
    )
    .returning({
      status: sandboxInstances.status,
    });

  if (updatedRows[0]?.status === SandboxInstanceStatuses.STOPPED) {
    return;
  }

  throw new Error("Failed to transition sandbox instance status from starting to stopped.");
}

async function markRunningSandboxInstanceFailed(
  ctx: Pick<GetSandboxInstanceContext, "db" | "tables">,
  input: {
    sandboxInstanceId: string;
    failureCode: string;
    failureMessage: string;
  },
): Promise<void> {
  const { sandboxInstances } = ctx.tables;

  const updatedRows = await ctx.db
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
        eq(sandboxInstances.status, SandboxInstanceStatuses.RUNNING),
      ),
    )
    .returning({
      status: sandboxInstances.status,
    });

  if (updatedRows[0]?.status === SandboxInstanceStatuses.FAILED) {
    return;
  }

  throw new Error("Failed to transition sandbox instance status from running to failed.");
}

async function markStoppedSandboxInstanceFailed(
  ctx: Pick<GetSandboxInstanceContext, "db" | "tables">,
  input: {
    sandboxInstanceId: string;
    failureCode: string;
    failureMessage: string;
  },
): Promise<void> {
  const { sandboxInstances } = ctx.tables;

  const updatedRows = await ctx.db
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
    });

  if (updatedRows[0]?.status === SandboxInstanceStatuses.FAILED) {
    return;
  }

  throw new Error("Failed to transition sandbox instance status from stopped to failed.");
}

async function inspectStartingSandboxInstance(
  ctx: GetSandboxInstanceContext,
  sandboxInstance: InspectableSandboxInstance,
): Promise<NonNullable<GetSandboxInstanceResponse>> {
  if (
    sandboxInstance.providerSandboxId === null &&
    sandboxInstance.persistenceMode === SandboxInstancePersistenceModes.PERSISTENT
  ) {
    await markStartingSandboxInstanceStopped(ctx, {
      sandboxInstanceId: sandboxInstance.id,
      clearProviderSandboxId: true,
    });
    return {
      id: sandboxInstance.id,
      title: sandboxInstance.title,
      status: SandboxInstanceStatuses.STOPPED,
      connectable: false,
      failureCode: null,
      failureMessage: null,
      runtimePlan: sandboxInstance.runtimePlan,
      startupOperation: null,
    };
  }

  if (sandboxInstance.providerSandboxId === null) {
    throw new Error(
      `Expected starting sandbox instance '${sandboxInstance.id}' to have a providerSandboxId.`,
    );
  }

  const inspection = await inspectSandboxInstanceOrNull(
    ctx,
    sandboxInstance,
    sandboxInstance.providerSandboxId,
  );

  if (inspection === null) {
    if (sandboxInstance.persistenceMode === SandboxInstancePersistenceModes.PERSISTENT) {
      await markStartingSandboxInstanceStopped(ctx, {
        sandboxInstanceId: sandboxInstance.id,
        clearProviderSandboxId: true,
      });
      return {
        id: sandboxInstance.id,
        title: sandboxInstance.title,
        status: SandboxInstanceStatuses.STOPPED,
        connectable: false,
        failureCode: null,
        failureMessage: null,
        runtimePlan: sandboxInstance.runtimePlan,
        startupOperation: null,
      };
    }

    await markStartingSandboxInstanceFailed(ctx, {
      sandboxInstanceId: sandboxInstance.id,
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
        persistedStatus: SandboxInstanceStatuses.STARTING,
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

  if (sandboxInstance.persistenceMode === SandboxInstancePersistenceModes.PERSISTENT) {
    await markStartingSandboxInstanceStopped(ctx, {
      sandboxInstanceId: sandboxInstance.id,
      clearProviderSandboxId: true,
    });
    return {
      id: sandboxInstance.id,
      title: sandboxInstance.title,
      status: SandboxInstanceStatuses.STOPPED,
      connectable: false,
      failureCode: null,
      failureMessage: null,
      runtimePlan: sandboxInstance.runtimePlan,
      startupOperation: null,
    };
  }

  await markStartingSandboxInstanceFailed(ctx, {
    sandboxInstanceId: sandboxInstance.id,
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
}): NonNullable<GetSandboxInstanceResponse> {
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
): Promise<NonNullable<GetSandboxInstanceResponse>> {
  if (
    sandboxInstance.providerSandboxId === null &&
    sandboxInstance.persistenceMode === SandboxInstancePersistenceModes.PERSISTENT
  ) {
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
    if (sandboxInstance.persistenceMode === SandboxInstancePersistenceModes.PERSISTENT) {
      await clearStoppedSandboxInstanceProviderSandboxId(ctx, {
        sandboxInstanceId: sandboxInstance.id,
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

    await markStoppedSandboxInstanceFailed(ctx, {
      sandboxInstanceId: sandboxInstance.id,
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

  if (
    inspection.disposition === SandboxInspectDispositions.RESUMABLE_STOPPED ||
    inspection.disposition === SandboxInspectDispositions.ACTIVE
  ) {
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

  if (sandboxInstance.persistenceMode === SandboxInstancePersistenceModes.PERSISTENT) {
    await clearStoppedSandboxInstanceProviderSandboxId(ctx, {
      sandboxInstanceId: sandboxInstance.id,
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

  await markStoppedSandboxInstanceFailed(ctx, {
    sandboxInstanceId: sandboxInstance.id,
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
): Promise<NonNullable<GetSandboxInstanceResponse>> {
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
    if (sandboxInstance.persistenceMode === SandboxInstancePersistenceModes.PERSISTENT) {
      await markRunningSandboxInstanceStopped(ctx, {
        sandboxInstanceId: sandboxInstance.id,
        clearProviderSandboxId: true,
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

    await markRunningSandboxInstanceFailed(ctx, {
      sandboxInstanceId: sandboxInstance.id,
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
        persistedStatus: SandboxInstanceStatuses.RUNNING,
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
    sandboxInstanceId: sandboxInstance.id,
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
      storageMb?: number;
    }
  | undefined {
  if (
    input.sandboxVcpuCount === null &&
    input.sandboxMemoryMb === null &&
    input.sandboxStorageMb === null
  ) {
    return undefined;
  }

  if (input.sandboxVcpuCount === null || input.sandboxMemoryMb === null) {
    throw new Error("Persisted sandbox resources are incomplete.");
  }

  return {
    vcpuCount: input.sandboxVcpuCount,
    memoryMb: input.sandboxMemoryMb,
    ...(input.sandboxStorageMb === null ? {} : { storageMb: input.sandboxStorageMb }),
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
  const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
    columns: {
      id: true,
      organizationId: true,
      title: true,
      persistenceMode: true,
      runtimeProvider: true,
      sandboxConnectionId: true,
      sandboxVcpuCount: true,
      sandboxMemoryMb: true,
      sandboxStorageMb: true,
      providerSandboxId: true,
      status: true,
      failureCode: true,
      failureMessage: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        eq(table.id, input.instanceId),
        whereEq(table.organizationId, input.organizationId),
        or(
          whereEq(table.purpose, SandboxInstancePurposes.SESSION),
          whereEq(table.purpose, SandboxInstancePurposes.SETUP_CHECK),
        ),
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

  let response: NonNullable<GetSandboxInstanceResponse>;
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
    case SandboxInstanceStatuses.RUNNING: {
      response = await inspectRunningSandboxInstance(ctx, {
        ...sandboxInstance,
        runtimePlan,
      });
      break;
    }
    default:
      throw new Error("Unsupported sandbox instance status.");
  }

  return {
    ...response,
    startupOperation: await readLatestStartupOperation({
      db: ctx.db,
      sandboxInstanceId: sandboxInstance.id,
    }),
  };
}
