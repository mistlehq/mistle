import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  SandboxInstancePurposes,
  SandboxInstanceStatuses,
  SandboxStopReasons,
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstancePersistenceMode,
  type SandboxInstanceProvider,
  type SandboxInstanceStatus,
} from "@mistle/db/data-plane";
import { isSandboxResourceNotFoundError } from "@mistle/sandbox";
import { and, eq, sql } from "drizzle-orm";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import {
  createResolveSandboxRuntimeInput,
  type SandboxRuntimeProviderResolver,
} from "../core/sandbox-runtime-resolver.js";
import { clearSandboxInstanceDeadlines } from "../sandbox-instance-deadlines/clear-sandbox-instance-deadlines.js";
import { destroySandbox } from "../shared/destroy-sandbox.js";

type DeleteSandboxInstanceState = {
  organizationId: string;
  persistenceMode: SandboxInstancePersistenceMode;
  runtimeProvider: SandboxInstanceProvider;
  sandboxConnectionId: string | null;
  sandboxVcpuCount: number | null;
  sandboxMemoryMb: number | null;
  sandboxStorageMb: number | null;
  providerSandboxId: string | null;
  computeGeneration: number;
  status: SandboxInstanceStatus;
};

export type DeleteSandboxInstanceResult = {
  sandboxInstanceId: string;
  executed: boolean;
  outcome: "destroyed" | "no_provider_sandbox";
  usageEventState?: {
    organizationId: string;
    runtimeProvider: SandboxInstanceProvider;
    providerSandboxId: string;
    computeGeneration: number;
    vcpuCount: number | null;
    memoryMb: number | null;
    storageMb: number | null;
  };
};

async function resolveDeleteSandboxInstanceState(input: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
}): Promise<DeleteSandboxInstanceState> {
  const sandboxInstance = await input.db.query.sandboxInstances.findFirst({
    columns: {
      organizationId: true,
      persistenceMode: true,
      runtimeProvider: true,
      sandboxConnectionId: true,
      sandboxVcpuCount: true,
      sandboxMemoryMb: true,
      sandboxStorageMb: true,
      providerSandboxId: true,
      computeGeneration: true,
      status: true,
      purpose: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.id, input.sandboxInstanceId),
  });

  if (sandboxInstance === undefined) {
    throw new Error(`Sandbox instance '${input.sandboxInstanceId}' was not found.`);
  }

  if (sandboxInstance.purpose !== SandboxInstancePurposes.SESSION) {
    throw new Error(
      `Delete sandbox instance workflow is only supported for session sandbox instances; sandbox instance '${input.sandboxInstanceId}' has purpose '${sandboxInstance.purpose}'.`,
    );
  }

  return sandboxInstance;
}

async function markDeletedSandboxProviderComputeDestroyed(ctx: {
  db: DataPlaneDatabase;
  tables: Pick<DataPlaneTables, "sandboxInstanceDeadlines" | "sandboxInstances">;
  sandboxInstanceId: string;
  providerSandboxId: string;
}): Promise<{
  transitionedRunningToStopped: boolean;
}> {
  return ctx.db.transaction(async (tx) => {
    const { sandboxInstances } = ctx.tables;
    const lockedRows = await tx.execute(
      sql<{ status: SandboxInstanceStatus; provider_sandbox_id: string | null }>`
        select status, provider_sandbox_id
        from ${sandboxInstances}
        where id = ${ctx.sandboxInstanceId}
        for update
      `,
    );
    const lockedRow = lockedRows.rows[0];

    if (lockedRow === undefined) {
      throw new Error(`Sandbox instance '${ctx.sandboxInstanceId}' was not found.`);
    }

    if (lockedRow.provider_sandbox_id !== ctx.providerSandboxId) {
      return {
        transitionedRunningToStopped: false,
      };
    }

    if (lockedRow.status === SandboxInstanceStatuses.RUNNING) {
      await tx
        .update(sandboxInstances)
        .set({
          status: SandboxInstanceStatuses.STOPPED,
          providerSandboxId: null,
          stoppedAt: sql`now()`,
          stopReason: SandboxStopReasons.USER,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(sandboxInstances.id, ctx.sandboxInstanceId),
            eq(sandboxInstances.providerSandboxId, ctx.providerSandboxId),
          ),
        );
    } else {
      await tx
        .update(sandboxInstances)
        .set({
          providerSandboxId: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(sandboxInstances.id, ctx.sandboxInstanceId),
            eq(sandboxInstances.providerSandboxId, ctx.providerSandboxId),
          ),
        );
    }

    await clearSandboxInstanceDeadlines({
      db: tx,
      tables: ctx.tables,
      sandboxInstanceId: ctx.sandboxInstanceId,
    });

    return {
      transitionedRunningToStopped: lockedRow.status === SandboxInstanceStatuses.RUNNING,
    };
  });
}

export async function deleteSandboxInstance(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    db: DataPlaneDatabase;
    tables: DataPlaneTables;
    controlPlaneInternalClient: ControlPlaneInternalClient;
    sandboxRuntimeProviderResolver: SandboxRuntimeProviderResolver;
  },
  input: {
    sandboxInstanceId: string;
  },
): Promise<DeleteSandboxInstanceResult> {
  const sandboxInstanceState = await resolveDeleteSandboxInstanceState({
    db: ctx.db,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  if (sandboxInstanceState.providerSandboxId === null) {
    await clearSandboxInstanceDeadlines({
      db: ctx.db,
      tables: ctx.tables,
      sandboxInstanceId: input.sandboxInstanceId,
    });

    return {
      sandboxInstanceId: input.sandboxInstanceId,
      executed: false,
      outcome: "no_provider_sandbox",
    };
  }

  const providerSandboxId = sandboxInstanceState.providerSandboxId;
  const resolvedRuntime = await ctx.sandboxRuntimeProviderResolver.resolve(
    createResolveSandboxRuntimeInput(sandboxInstanceState),
  );

  try {
    await destroySandbox(
      {
        db: ctx.db,
        tables: ctx.tables,
        controlPlaneInternalClient: ctx.controlPlaneInternalClient,
        config: ctx.config,
        sandboxAdapter: resolvedRuntime.sandboxAdapter,
      },
      {
        sandboxInstanceId: input.sandboxInstanceId,
        organizationId: sandboxInstanceState.organizationId,
        persistenceMode: sandboxInstanceState.persistenceMode,
        runtimeProvider: sandboxInstanceState.runtimeProvider,
        providerSandboxId,
      },
    );
  } catch (error) {
    if (!isSandboxResourceNotFoundError(error)) {
      throw error;
    }
  }

  const markResult = await markDeletedSandboxProviderComputeDestroyed({
    db: ctx.db,
    tables: ctx.tables,
    sandboxInstanceId: input.sandboxInstanceId,
    providerSandboxId,
  });

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    executed: true,
    outcome: "destroyed",
    ...(markResult.transitionedRunningToStopped
      ? {
          usageEventState: {
            organizationId: sandboxInstanceState.organizationId,
            runtimeProvider: sandboxInstanceState.runtimeProvider,
            providerSandboxId,
            computeGeneration: sandboxInstanceState.computeGeneration,
            vcpuCount: sandboxInstanceState.sandboxVcpuCount,
            memoryMb: sandboxInstanceState.sandboxMemoryMb,
            storageMb: sandboxInstanceState.sandboxStorageMb,
          },
        }
      : {}),
  };
}
