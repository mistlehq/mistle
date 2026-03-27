import {
  SandboxInstanceStatuses,
  SandboxStopReasons,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import {
  isSandboxResourceNotFoundError,
  SandboxInspectStates,
  type SandboxAdapter,
  type SandboxProvider,
} from "@mistle/sandbox";
import { and, eq, sql } from "drizzle-orm";

import type {
  GetSandboxInstanceInput,
  GetSandboxInstanceResponse,
} from "../get-sandbox-instance/schema.js";

type GetSandboxInstanceByInspectionContext = {
  db: DataPlaneDatabase;
  sandboxAdapter: SandboxAdapter;
  sandboxProvider: SandboxProvider;
};

async function markRunningSandboxInstanceStopped(
  ctx: Pick<GetSandboxInstanceByInspectionContext, "db">,
  input: {
    sandboxInstanceId: string;
  },
): Promise<void> {
  const updatedRows = await ctx.db
    .update(sandboxInstances)
    .set({
      status: SandboxInstanceStatuses.STOPPED,
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

async function inspectStartingSandboxInstance(
  ctx: GetSandboxInstanceByInspectionContext,
  sandboxInstance: {
    id: string;
    providerSandboxId: string | null;
    failureCode: string | null;
    failureMessage: string | null;
  },
): Promise<NonNullable<GetSandboxInstanceResponse>> {
  if (sandboxInstance.providerSandboxId === null) {
    return {
      id: sandboxInstance.id,
      status: SandboxInstanceStatuses.STARTING,
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
    };
  }

  const inspection = await inspectSandboxInstanceOrNull(ctx, sandboxInstance.providerSandboxId);

  if (inspection === null) {
    return {
      id: sandboxInstance.id,
      status: SandboxInstanceStatuses.STARTING,
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
    };
  }

  if (inspection.state === SandboxInspectStates.RUNNING) {
    return {
      id: sandboxInstance.id,
      status: SandboxInstanceStatuses.RUNNING,
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
    };
  }

  return {
    id: sandboxInstance.id,
    status: SandboxInstanceStatuses.STARTING,
    failureCode: sandboxInstance.failureCode,
    failureMessage: sandboxInstance.failureMessage,
  };
}

async function inspectRunningSandboxInstance(
  ctx: GetSandboxInstanceByInspectionContext,
  sandboxInstance: {
    id: string;
    providerSandboxId: string | null;
    failureCode: string | null;
    failureMessage: string | null;
  },
): Promise<NonNullable<GetSandboxInstanceResponse>> {
  if (sandboxInstance.providerSandboxId === null) {
    throw new Error(
      `Expected running sandbox instance '${sandboxInstance.id}' to have a providerSandboxId.`,
    );
  }

  const inspection = await inspectSandboxInstanceOrNull(ctx, sandboxInstance.providerSandboxId);
  if (inspection === null) {
    await markRunningSandboxInstanceStopped(ctx, {
      sandboxInstanceId: sandboxInstance.id,
    });
    return {
      id: sandboxInstance.id,
      status: SandboxInstanceStatuses.STOPPED,
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
    };
  }

  if (inspection.state === SandboxInspectStates.RUNNING) {
    return {
      id: sandboxInstance.id,
      status: SandboxInstanceStatuses.RUNNING,
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
    };
  }

  await markRunningSandboxInstanceStopped(ctx, {
    sandboxInstanceId: sandboxInstance.id,
  });

  return {
    id: sandboxInstance.id,
    status: SandboxInstanceStatuses.STOPPED,
    failureCode: sandboxInstance.failureCode,
    failureMessage: sandboxInstance.failureMessage,
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
      runtimeProvider: true,
      providerSandboxId: true,
      status: true,
      failureCode: true,
      failureMessage: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(eq(table.id, input.instanceId), whereEq(table.organizationId, input.organizationId)),
  });
  if (sandboxInstance === undefined) {
    return null;
  }

  if (sandboxInstance.runtimeProvider !== ctx.sandboxProvider) {
    throw new Error(
      `Sandbox instance '${sandboxInstance.id}' runtime provider '${sandboxInstance.runtimeProvider}' does not match configured provider '${ctx.sandboxProvider}'.`,
    );
  }

  switch (sandboxInstance.status) {
    case SandboxInstanceStatuses.FAILED:
      return {
        id: sandboxInstance.id,
        status: SandboxInstanceStatuses.FAILED,
        failureCode: sandboxInstance.failureCode,
        failureMessage: sandboxInstance.failureMessage,
      };
    case SandboxInstanceStatuses.STOPPED:
      return {
        id: sandboxInstance.id,
        status: SandboxInstanceStatuses.STOPPED,
        failureCode: sandboxInstance.failureCode,
        failureMessage: sandboxInstance.failureMessage,
      };
    case SandboxInstanceStatuses.STARTING: {
      return inspectStartingSandboxInstance(ctx, sandboxInstance);
    }
    case SandboxInstanceStatuses.RUNNING: {
      return inspectRunningSandboxInstance(ctx, sandboxInstance);
    }
    default:
      throw new Error("Unsupported sandbox instance status.");
  }
}
