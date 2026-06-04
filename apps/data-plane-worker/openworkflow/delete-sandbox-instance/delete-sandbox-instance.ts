import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  SandboxInstanceStatuses,
  SandboxStopReasons,
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstanceProvider,
  type SandboxInstanceStatus,
} from "@mistle/db/data-plane";
import { isSandboxResourceNotFoundError } from "@mistle/sandbox";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import {
  createResolveSandboxRuntimeInput,
  type SandboxRuntimeProviderResolver,
} from "../core/sandbox-runtime-resolver.js";
import { clearSandboxInstanceDeadlines } from "../sandbox-instance-deadlines/clear-sandbox-instance-deadlines.js";
import { destroySandbox } from "../shared/destroy-sandbox.js";

type DeleteSandboxInstanceState = {
  organizationId: string;
  runtimeProvider: SandboxInstanceProvider;
  sandboxConnectionId: string | null;
  sandboxVcpuCount: number | null;
  sandboxMemoryMb: number | null;
  sandboxDiskMb: number | null;
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
    diskMb: number | null;
  };
};

const StartupStatuses = new Set<SandboxInstanceStatus>([
  SandboxInstanceStatuses.PENDING,
  SandboxInstanceStatuses.STARTING,
  SandboxInstanceStatuses.STARTED,
  SandboxInstanceStatuses.INITIALIZING,
]);

const LockedSandboxInstanceRowSchema = z
  .object({
    status: z.enum([
      SandboxInstanceStatuses.PENDING,
      SandboxInstanceStatuses.STARTING,
      SandboxInstanceStatuses.STARTED,
      SandboxInstanceStatuses.INITIALIZING,
      SandboxInstanceStatuses.RUNNING,
      SandboxInstanceStatuses.DEGRADED,
      SandboxInstanceStatuses.RECONNECTING,
      SandboxInstanceStatuses.STOPPING,
      SandboxInstanceStatuses.STOPPED,
      SandboxInstanceStatuses.FAILED,
    ]),
    provider_sandbox_id: z.string().min(1).nullable(),
  })
  .strict();

export function shouldTransitionDeletedProviderCleanupToStopped(
  status: SandboxInstanceStatus,
): boolean {
  return StartupStatuses.has(status);
}

async function resolveDeleteSandboxInstanceState(input: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
}): Promise<DeleteSandboxInstanceState> {
  const sandboxInstance = await input.db.query.sandboxInstances.findFirst({
    columns: {
      organizationId: true,
      runtimeProvider: true,
      sandboxConnectionId: true,
      sandboxVcpuCount: true,
      sandboxMemoryMb: true,
      sandboxDiskMb: true,
      providerSandboxId: true,
      computeGeneration: true,
      status: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.id, input.sandboxInstanceId),
  });

  if (sandboxInstance === undefined) {
    throw new Error(`Sandbox instance '${input.sandboxInstanceId}' was not found.`);
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
      sql`
        select status, provider_sandbox_id
        from ${sandboxInstances}
        where id = ${ctx.sandboxInstanceId}
        for update
      `,
    );
    const lockedRow = LockedSandboxInstanceRowSchema.optional().parse(lockedRows.rows[0]);

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
      const shouldTransitionToStopped = shouldTransitionDeletedProviderCleanupToStopped(
        lockedRow.status,
      );

      await tx
        .update(sandboxInstances)
        .set({
          ...(shouldTransitionToStopped
            ? {
                status: SandboxInstanceStatuses.STOPPED,
                stoppedAt: sql`now()`,
                stopReason: SandboxStopReasons.USER,
              }
            : {}),
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
    if (StartupStatuses.has(sandboxInstanceState.status)) {
      throw new Error(
        `Sandbox instance '${input.sandboxInstanceId}' is still starting and does not have persisted provider sandbox metadata yet.`,
      );
    }

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
        sandboxAdapter: resolvedRuntime.sandboxAdapter,
      },
      {
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
            diskMb: sandboxInstanceState.sandboxDiskMb,
          },
        }
      : {}),
  };
}
