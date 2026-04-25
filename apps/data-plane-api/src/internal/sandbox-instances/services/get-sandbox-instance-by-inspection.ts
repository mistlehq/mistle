import {
  SandboxInstancePersistenceModes,
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

async function markRunningSandboxInstanceStopped(
  ctx: Pick<GetSandboxInstanceByInspectionContext, "db">,
  input: {
    sandboxInstanceId: string;
    clearProviderSandboxId?: boolean;
  },
): Promise<void> {
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
): Promise<void> {
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
  ctx: Pick<GetSandboxInstanceByInspectionContext, "db">,
  input: {
    sandboxInstanceId: string;
    clearProviderSandboxId?: boolean;
  },
): Promise<void> {
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
  ctx: Pick<GetSandboxInstanceByInspectionContext, "db">,
  input: {
    sandboxInstanceId: string;
    failureCode: string;
    failureMessage: string;
  },
): Promise<void> {
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
  ctx: Pick<GetSandboxInstanceByInspectionContext, "db">,
  input: {
    sandboxInstanceId: string;
    failureCode: string;
    failureMessage: string;
  },
): Promise<void> {
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
  ctx: GetSandboxInstanceByInspectionContext,
  sandboxInstance: {
    id: string;
    title: string | null;
    persistenceMode: string;
    providerSandboxId: string | null;
    failureCode: string | null;
    failureMessage: string | null;
    runtimePlan: PersistedRuntimePlan;
  },
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
  };
}

async function inspectStoppedSandboxInstance(
  ctx: GetSandboxInstanceByInspectionContext,
  sandboxInstance: {
    id: string;
    title: string | null;
    persistenceMode: string;
    providerSandboxId: string | null;
    failureCode: string | null;
    failureMessage: string | null;
    runtimePlan: PersistedRuntimePlan;
  },
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
        id: sandboxInstance.id,
        title: sandboxInstance.title,
        status: SandboxInstanceStatuses.STOPPED,
        connectable: false,
        failureCode: sandboxInstance.failureCode,
        failureMessage: sandboxInstance.failureMessage,
        runtimePlan: sandboxInstance.runtimePlan,
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
  };
}

async function inspectRunningSandboxInstance(
  ctx: GetSandboxInstanceByInspectionContext,
  sandboxInstance: {
    id: string;
    title: string | null;
    persistenceMode: string;
    providerSandboxId: string | null;
    failureCode: string | null;
    failureMessage: string | null;
    runtimePlan: PersistedRuntimePlan;
  },
): Promise<NonNullable<GetSandboxInstanceResponse>> {
  if (sandboxInstance.providerSandboxId === null) {
    throw new Error(
      `Expected running sandbox instance '${sandboxInstance.id}' to have a providerSandboxId.`,
    );
  }

  const inspection = await inspectSandboxInstanceOrNull(ctx, sandboxInstance.providerSandboxId);
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
      title: true,
      persistenceMode: true,
      runtimeProvider: true,
      providerSandboxId: true,
      status: true,
      failureCode: true,
      failureMessage: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        eq(table.id, input.instanceId),
        whereEq(table.organizationId, input.organizationId),
        whereEq(table.purpose, SandboxInstancePurposes.SESSION),
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
        id: sandboxInstance.id,
        title: sandboxInstance.title,
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
