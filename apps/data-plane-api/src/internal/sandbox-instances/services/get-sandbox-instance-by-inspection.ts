import {
  SandboxInstancePersistenceModes,
  type SandboxInstancePurpose,
  type SandboxInstanceStatus,
  SandboxInstancePurposes,
  SandboxInstanceStatuses,
  SandboxStopReasons,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import { CompiledRuntimePlanSchema } from "@mistle/integrations-core";
import {
  isSandboxResourceNotFoundError,
  SandboxInspectDispositions,
  SandboxInspectStates,
  type SandboxAdapter,
  type SandboxProvider,
} from "@mistle/sandbox";
import { and, eq, sql } from "drizzle-orm";

import type { AppRuntimeResources } from "../../../resources.js";
import type {
  GetSandboxInstanceInput,
  GetSandboxInstanceResponse,
} from "../get-sandbox-instance/schema.js";
import { readEffectiveSandboxStatus } from "./read-effective-sandbox-status.js";
import {
  determineStartingSandboxInspectionOutcome,
  StartingSandboxInspectionOutcomes,
} from "./starting-sandbox-inspection-policy.js";

type GetSandboxInstanceByInspectionContext = {
  db: DataPlaneDatabase;
  sandboxAdapter: SandboxAdapter;
  runtimeStateReader: AppRuntimeResources["runtimeStateReader"];
  sandboxProvider: SandboxProvider;
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

type SandboxInstanceResponseMetadata = {
  id: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  purpose: SandboxInstancePurpose;
  title: string | null;
  status: SandboxInstanceStatus;
  startedAt: string | null;
  stoppedAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function sandboxInstanceResponseBase(
  sandboxInstance: SandboxInstanceResponseMetadata,
): Pick<
  NonNullable<GetSandboxInstanceResponse>,
  | "id"
  | "sandboxProfileId"
  | "sandboxProfileVersion"
  | "purpose"
  | "title"
  | "persistedStatus"
  | "startedAt"
  | "stoppedAt"
  | "failedAt"
  | "createdAt"
  | "updatedAt"
> {
  return {
    id: sandboxInstance.id,
    sandboxProfileId: sandboxInstance.sandboxProfileId,
    sandboxProfileVersion: sandboxInstance.sandboxProfileVersion,
    purpose: sandboxInstance.purpose,
    title: sandboxInstance.title,
    persistedStatus: sandboxInstance.status,
    startedAt: sandboxInstance.startedAt,
    stoppedAt: sandboxInstance.stoppedAt,
    failedAt: sandboxInstance.failedAt,
    createdAt: sandboxInstance.createdAt,
    updatedAt: sandboxInstance.updatedAt,
  };
}

function sandboxInstanceResponseBaseWithPersistedStatus(
  sandboxInstance: SandboxInstanceResponseMetadata,
  persistedStatus: SandboxInstanceStatus,
): ReturnType<typeof sandboxInstanceResponseBase> {
  return sandboxInstanceResponseBase({
    ...sandboxInstance,
    status: persistedStatus,
  });
}

async function markRunningSandboxInstanceStopped(
  ctx: Pick<GetSandboxInstanceByInspectionContext, "db">,
  input: {
    sandboxInstanceId: string;
    clearProviderSandboxId?: boolean;
  },
): Promise<SandboxInstanceStatus> {
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
    return updatedRows[0].status;
  }

  throw new Error("Failed to transition sandbox instance status from running to stopped.");
}

async function clearStoppedSandboxInstanceProviderSandboxId(
  ctx: Pick<GetSandboxInstanceByInspectionContext, "db">,
  input: {
    sandboxInstanceId: string;
  },
): Promise<void> {
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
  ctx: Pick<GetSandboxInstanceByInspectionContext, "db">,
  input: {
    sandboxInstanceId: string;
    failureCode: string;
    failureMessage: string;
  },
): Promise<SandboxInstanceStatus> {
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
    return updatedRows[0].status;
  }

  throw new Error("Failed to transition sandbox instance status from starting to failed.");
}

async function markStartingSandboxInstanceStopped(
  ctx: Pick<GetSandboxInstanceByInspectionContext, "db">,
  input: {
    sandboxInstanceId: string;
    clearProviderSandboxId?: boolean;
  },
): Promise<SandboxInstanceStatus> {
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
    return updatedRows[0].status;
  }

  throw new Error("Failed to transition sandbox instance status from starting to stopped.");
}

async function markRunningSandboxInstanceFailed(
  ctx: Pick<GetSandboxInstanceByInspectionContext, "db">,
  input: {
    sandboxInstanceId: string;
    failureCode: string;
    failureMessage: string;
  },
): Promise<SandboxInstanceStatus> {
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
    return updatedRows[0].status;
  }

  throw new Error("Failed to transition sandbox instance status from running to failed.");
}

async function markStoppedSandboxInstanceFailed(
  ctx: Pick<GetSandboxInstanceByInspectionContext, "db">,
  input: {
    sandboxInstanceId: string;
    failureCode: string;
    failureMessage: string;
  },
): Promise<SandboxInstanceStatus> {
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
    return updatedRows[0].status;
  }

  throw new Error("Failed to transition sandbox instance status from stopped to failed.");
}

async function inspectStartingSandboxInstance(
  ctx: GetSandboxInstanceByInspectionContext,
  sandboxInstance: {
    persistenceMode: string;
    providerSandboxId: string | null;
    failureCode: string | null;
    failureMessage: string | null;
    runtimePlan: PersistedRuntimePlan;
  } & SandboxInstanceResponseMetadata,
): Promise<NonNullable<GetSandboxInstanceResponse>> {
  if (
    sandboxInstance.providerSandboxId === null &&
    sandboxInstance.persistenceMode === SandboxInstancePersistenceModes.PERSISTENT
  ) {
    const persistedStatus = await markStartingSandboxInstanceStopped(ctx, {
      sandboxInstanceId: sandboxInstance.id,
      clearProviderSandboxId: true,
    });
    return {
      ...sandboxInstanceResponseBaseWithPersistedStatus(sandboxInstance, persistedStatus),
      status: SandboxInstanceStatuses.STOPPED,
      connectable: false,
      failureCode: null,
      failureMessage: null,
      runtimePlan: sandboxInstance.runtimePlan,
    };
  }

  if (sandboxInstance.providerSandboxId === null) {
    throw new Error(
      `Expected starting sandbox instance '${sandboxInstance.id}' to have a providerSandboxId.`,
    );
  }

  const inspection = await inspectSandboxInstanceOrNull(ctx, sandboxInstance.providerSandboxId);

  if (inspection === null) {
    if (sandboxInstance.persistenceMode === SandboxInstancePersistenceModes.PERSISTENT) {
      const persistedStatus = await markStartingSandboxInstanceStopped(ctx, {
        sandboxInstanceId: sandboxInstance.id,
        clearProviderSandboxId: true,
      });
      return {
        ...sandboxInstanceResponseBaseWithPersistedStatus(sandboxInstance, persistedStatus),
        status: SandboxInstanceStatuses.STOPPED,
        connectable: false,
        failureCode: null,
        failureMessage: null,
        runtimePlan: sandboxInstance.runtimePlan,
      };
    }

    const persistedStatus = await markStartingSandboxInstanceFailed(ctx, {
      sandboxInstanceId: sandboxInstance.id,
      failureCode: InspectionFailureCodes.PROVIDER_RUNTIME_MISSING,
      failureMessage: "Sandbox runtime was not found at the provider during startup inspection.",
    });
    return {
      ...sandboxInstanceResponseBaseWithPersistedStatus(sandboxInstance, persistedStatus),
      status: SandboxInstanceStatuses.FAILED,
      connectable: false,
      failureCode: InspectionFailureCodes.PROVIDER_RUNTIME_MISSING,
      failureMessage: "Sandbox runtime was not found at the provider during startup inspection.",
      runtimePlan: sandboxInstance.runtimePlan,
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
      ...sandboxInstanceResponseBase(sandboxInstance),
      status,
      connectable: status === "running",
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
      runtimePlan: sandboxInstance.runtimePlan,
    };
  }

  if (sandboxInstance.persistenceMode === SandboxInstancePersistenceModes.PERSISTENT) {
    const persistedStatus = await markStartingSandboxInstanceStopped(ctx, {
      sandboxInstanceId: sandboxInstance.id,
      clearProviderSandboxId: true,
    });
    return {
      ...sandboxInstanceResponseBaseWithPersistedStatus(sandboxInstance, persistedStatus),
      status: SandboxInstanceStatuses.STOPPED,
      connectable: false,
      failureCode: null,
      failureMessage: null,
      runtimePlan: sandboxInstance.runtimePlan,
    };
  }

  const persistedStatus = await markStartingSandboxInstanceFailed(ctx, {
    sandboxInstanceId: sandboxInstance.id,
    failureCode: dispositionOutcome.failureCode,
    failureMessage: dispositionOutcome.failureMessage,
  });

  return {
    ...sandboxInstanceResponseBaseWithPersistedStatus(sandboxInstance, persistedStatus),
    status: SandboxInstanceStatuses.FAILED,
    connectable: false,
    failureCode: dispositionOutcome.failureCode,
    failureMessage: dispositionOutcome.failureMessage,
    runtimePlan: sandboxInstance.runtimePlan,
  };
}

function readPendingSandboxInstance(
  sandboxInstance: {
    failureCode: string | null;
    failureMessage: string | null;
    runtimePlan: PersistedRuntimePlan;
  } & SandboxInstanceResponseMetadata,
): NonNullable<GetSandboxInstanceResponse> {
  return {
    ...sandboxInstanceResponseBase(sandboxInstance),
    status: SandboxInstanceStatuses.PENDING,
    connectable: false,
    failureCode: sandboxInstance.failureCode,
    failureMessage: sandboxInstance.failureMessage,
    runtimePlan: sandboxInstance.runtimePlan,
  };
}

async function inspectStoppedSandboxInstance(
  ctx: GetSandboxInstanceByInspectionContext,
  sandboxInstance: {
    persistenceMode: string;
    providerSandboxId: string | null;
    failureCode: string | null;
    failureMessage: string | null;
    runtimePlan: PersistedRuntimePlan;
  } & SandboxInstanceResponseMetadata,
): Promise<NonNullable<GetSandboxInstanceResponse>> {
  if (sandboxInstance.purpose === SandboxInstancePurposes.SETUP_CHECK) {
    return {
      ...sandboxInstanceResponseBase(sandboxInstance),
      status: SandboxInstanceStatuses.STOPPED,
      connectable: false,
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
      runtimePlan: sandboxInstance.runtimePlan,
    };
  }

  if (
    sandboxInstance.providerSandboxId === null &&
    sandboxInstance.persistenceMode === SandboxInstancePersistenceModes.PERSISTENT
  ) {
    return {
      ...sandboxInstanceResponseBase(sandboxInstance),
      status: SandboxInstanceStatuses.STOPPED,
      connectable: false,
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
      runtimePlan: sandboxInstance.runtimePlan,
    };
  }

  if (sandboxInstance.providerSandboxId === null) {
    throw new Error(
      `Expected stopped sandbox instance '${sandboxInstance.id}' to have a providerSandboxId.`,
    );
  }

  const inspection = await inspectSandboxInstanceOrNull(ctx, sandboxInstance.providerSandboxId);
  if (inspection === null) {
    if (sandboxInstance.persistenceMode === SandboxInstancePersistenceModes.PERSISTENT) {
      await clearStoppedSandboxInstanceProviderSandboxId(ctx, {
        sandboxInstanceId: sandboxInstance.id,
      });
      return {
        ...sandboxInstanceResponseBase(sandboxInstance),
        status: SandboxInstanceStatuses.STOPPED,
        connectable: false,
        failureCode: sandboxInstance.failureCode,
        failureMessage: sandboxInstance.failureMessage,
        runtimePlan: sandboxInstance.runtimePlan,
      };
    }

    const persistedStatus = await markStoppedSandboxInstanceFailed(ctx, {
      sandboxInstanceId: sandboxInstance.id,
      failureCode: InspectionFailureCodes.PROVIDER_RUNTIME_MISSING,
      failureMessage: "Sandbox runtime was not found at the provider during inspection.",
    });
    return {
      ...sandboxInstanceResponseBaseWithPersistedStatus(sandboxInstance, persistedStatus),
      status: SandboxInstanceStatuses.FAILED,
      connectable: false,
      failureCode: InspectionFailureCodes.PROVIDER_RUNTIME_MISSING,
      failureMessage: "Sandbox runtime was not found at the provider during inspection.",
      runtimePlan: sandboxInstance.runtimePlan,
    };
  }

  if (
    inspection.disposition === SandboxInspectDispositions.RESUMABLE_STOPPED ||
    inspection.disposition === SandboxInspectDispositions.ACTIVE
  ) {
    return {
      ...sandboxInstanceResponseBase(sandboxInstance),
      status: SandboxInstanceStatuses.STOPPED,
      connectable: false,
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
      runtimePlan: sandboxInstance.runtimePlan,
    };
  }

  if (sandboxInstance.persistenceMode === SandboxInstancePersistenceModes.PERSISTENT) {
    await clearStoppedSandboxInstanceProviderSandboxId(ctx, {
      sandboxInstanceId: sandboxInstance.id,
    });
    return {
      ...sandboxInstanceResponseBase(sandboxInstance),
      status: SandboxInstanceStatuses.STOPPED,
      connectable: false,
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
      runtimePlan: sandboxInstance.runtimePlan,
    };
  }

  const persistedStatus = await markStoppedSandboxInstanceFailed(ctx, {
    sandboxInstanceId: sandboxInstance.id,
    failureCode: "provider_runtime_not_resumable",
    failureMessage: "Sandbox runtime was not resumable at the provider during inspection.",
  });
  return {
    ...sandboxInstanceResponseBaseWithPersistedStatus(sandboxInstance, persistedStatus),
    status: SandboxInstanceStatuses.FAILED,
    connectable: false,
    failureCode: "provider_runtime_not_resumable",
    failureMessage: "Sandbox runtime was not resumable at the provider during inspection.",
    runtimePlan: sandboxInstance.runtimePlan,
  };
}

async function inspectRunningSandboxInstance(
  ctx: GetSandboxInstanceByInspectionContext,
  sandboxInstance: {
    persistenceMode: string;
    providerSandboxId: string | null;
    failureCode: string | null;
    failureMessage: string | null;
    runtimePlan: PersistedRuntimePlan;
  } & SandboxInstanceResponseMetadata,
): Promise<NonNullable<GetSandboxInstanceResponse>> {
  if (sandboxInstance.providerSandboxId === null) {
    throw new Error(
      `Expected running sandbox instance '${sandboxInstance.id}' to have a providerSandboxId.`,
    );
  }

  const inspection = await inspectSandboxInstanceOrNull(ctx, sandboxInstance.providerSandboxId);
  if (inspection === null) {
    if (sandboxInstance.persistenceMode === SandboxInstancePersistenceModes.PERSISTENT) {
      const persistedStatus = await markRunningSandboxInstanceStopped(ctx, {
        sandboxInstanceId: sandboxInstance.id,
        clearProviderSandboxId: true,
      });
      return {
        ...sandboxInstanceResponseBaseWithPersistedStatus(sandboxInstance, persistedStatus),
        status: SandboxInstanceStatuses.STOPPED,
        connectable: false,
        failureCode: sandboxInstance.failureCode,
        failureMessage: sandboxInstance.failureMessage,
        runtimePlan: sandboxInstance.runtimePlan,
      };
    }

    const persistedStatus = await markRunningSandboxInstanceFailed(ctx, {
      sandboxInstanceId: sandboxInstance.id,
      failureCode: InspectionFailureCodes.PROVIDER_RUNTIME_MISSING,
      failureMessage: "Sandbox runtime was not found at the provider during inspection.",
    });
    return {
      ...sandboxInstanceResponseBaseWithPersistedStatus(sandboxInstance, persistedStatus),
      status: SandboxInstanceStatuses.FAILED,
      connectable: false,
      failureCode: InspectionFailureCodes.PROVIDER_RUNTIME_MISSING,
      failureMessage: "Sandbox runtime was not found at the provider during inspection.",
      runtimePlan: sandboxInstance.runtimePlan,
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
      ...sandboxInstanceResponseBase(sandboxInstance),
      status,
      connectable: status === "running",
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
      runtimePlan: sandboxInstance.runtimePlan,
    };
  }

  const persistedStatus = await markRunningSandboxInstanceStopped(ctx, {
    sandboxInstanceId: sandboxInstance.id,
  });

  return {
    ...sandboxInstanceResponseBaseWithPersistedStatus(sandboxInstance, persistedStatus),
    status: SandboxInstanceStatuses.STOPPED,
    connectable: false,
    failureCode: sandboxInstance.failureCode,
    failureMessage: sandboxInstance.failureMessage,
    runtimePlan: sandboxInstance.runtimePlan,
  };
}

async function inspectSandboxInstanceOrNull(
  ctx: Pick<GetSandboxInstanceByInspectionContext, "sandboxAdapter">,
  providerSandboxId: string,
) {
  try {
    return await ctx.sandboxAdapter.inspect({
      id: providerSandboxId,
    });
  } catch (error) {
    if (!isSandboxResourceNotFoundError(error)) {
      throw error;
    }

    return null;
  }
}

export async function getSandboxInstanceByInspection(
  ctx: GetSandboxInstanceByInspectionContext,
  input: GetSandboxInstanceInput,
): Promise<GetSandboxInstanceResponse> {
  const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
    columns: {
      id: true,
      sandboxProfileId: true,
      sandboxProfileVersion: true,
      purpose: true,
      title: true,
      persistenceMode: true,
      runtimeProvider: true,
      providerSandboxId: true,
      status: true,
      failureCode: true,
      failureMessage: true,
      startedAt: true,
      stoppedAt: true,
      failedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        eq(table.id, input.instanceId),
        whereEq(table.organizationId, input.organizationId),
        whereEq(table.purpose, input.purpose ?? SandboxInstancePurposes.SESSION),
      ),
  });
  if (sandboxInstance === undefined) {
    return null;
  }

  const runtimePlan = await readPersistedRuntimePlan({
    db: ctx.db,
    sandboxInstanceId: sandboxInstance.id,
  });

  if (sandboxInstance.runtimeProvider !== ctx.sandboxProvider) {
    throw new Error(
      `Sandbox instance '${sandboxInstance.id}' runtime provider '${sandboxInstance.runtimeProvider}' does not match configured provider '${ctx.sandboxProvider}'.`,
    );
  }

  switch (sandboxInstance.status) {
    case SandboxInstanceStatuses.FAILED:
      return {
        ...sandboxInstanceResponseBase(sandboxInstance),
        status: SandboxInstanceStatuses.FAILED,
        connectable: false,
        failureCode: sandboxInstance.failureCode,
        failureMessage: sandboxInstance.failureMessage,
        runtimePlan,
      };
    case SandboxInstanceStatuses.STOPPED:
      return inspectStoppedSandboxInstance(ctx, {
        ...sandboxInstance,
        runtimePlan,
      });
    case SandboxInstanceStatuses.PENDING:
      return readPendingSandboxInstance({
        ...sandboxInstance,
        runtimePlan,
      });
    case SandboxInstanceStatuses.STARTING: {
      return inspectStartingSandboxInstance(ctx, {
        ...sandboxInstance,
        runtimePlan,
      });
    }
    case SandboxInstanceStatuses.RUNNING: {
      return inspectRunningSandboxInstance(ctx, {
        ...sandboxInstance,
        runtimePlan,
      });
    }
    default:
      throw new Error("Unsupported sandbox instance status.");
  }
}
