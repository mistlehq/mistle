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

type SandboxInstanceRecord = NonNullable<Awaited<ReturnType<typeof readSandboxInstanceRecord>>>;

function toResponse(input: {
  id: string;
  status: NonNullable<GetSandboxInstanceResponse>["status"];
  failureCode: string | null;
  failureMessage: string | null;
}): NonNullable<GetSandboxInstanceResponse> {
  return {
    id: input.id,
    status: input.status,
    failureCode: input.failureCode,
    failureMessage: input.failureMessage,
  };
}

async function readSandboxInstanceRecord(
  ctx: Pick<GetSandboxInstanceByInspectionContext, "db">,
  input: GetSandboxInstanceInput,
) {
  return ctx.db.query.sandboxInstances.findFirst({
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
}

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
      id: sandboxInstances.id,
    });

  if (updatedRows[0] !== undefined) {
    return;
  }

  const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
    columns: {
      status: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.id, input.sandboxInstanceId),
  });
  if (sandboxInstance?.status === SandboxInstanceStatuses.STOPPED) {
    return;
  }

  throw new Error("Failed to transition sandbox instance status from running to stopped.");
}

async function inspectStartingSandboxInstance(
  ctx: GetSandboxInstanceByInspectionContext,
  sandboxInstance: SandboxInstanceRecord,
): Promise<NonNullable<GetSandboxInstanceResponse>> {
  if (sandboxInstance.providerSandboxId === null) {
    return toResponse({
      id: sandboxInstance.id,
      status: SandboxInstanceStatuses.STARTING,
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
    });
  }

  const inspection = await ctx.sandboxAdapter
    .inspect({
      id: sandboxInstance.providerSandboxId,
    })
    .catch((error: unknown) => {
      if (isSandboxResourceNotFoundError(error)) {
        return null;
      }

      throw error;
    });

  if (inspection === null) {
    return toResponse({
      id: sandboxInstance.id,
      status: SandboxInstanceStatuses.STARTING,
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
    });
  }

  if (inspection.state === SandboxInspectStates.RUNNING) {
    return toResponse({
      id: sandboxInstance.id,
      status: SandboxInstanceStatuses.RUNNING,
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
    });
  }

  return toResponse({
    id: sandboxInstance.id,
    status: SandboxInstanceStatuses.STARTING,
    failureCode: sandboxInstance.failureCode,
    failureMessage: sandboxInstance.failureMessage,
  });
}

async function inspectRunningSandboxInstance(
  ctx: GetSandboxInstanceByInspectionContext,
  sandboxInstance: SandboxInstanceRecord,
): Promise<NonNullable<GetSandboxInstanceResponse>> {
  if (sandboxInstance.providerSandboxId === null) {
    throw new Error(
      `Expected running sandbox instance '${sandboxInstance.id}' to have a providerSandboxId.`,
    );
  }

  const inspection = await ctx.sandboxAdapter
    .inspect({
      id: sandboxInstance.providerSandboxId,
    })
    .catch(async (error: unknown) => {
      if (!isSandboxResourceNotFoundError(error)) {
        throw error;
      }

      await markRunningSandboxInstanceStopped(ctx, {
        sandboxInstanceId: sandboxInstance.id,
      });

      return null;
    });

  if (inspection === null) {
    return toResponse({
      id: sandboxInstance.id,
      status: SandboxInstanceStatuses.STOPPED,
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
    });
  }

  if (inspection.state === SandboxInspectStates.RUNNING) {
    return toResponse({
      id: sandboxInstance.id,
      status: SandboxInstanceStatuses.RUNNING,
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
    });
  }

  await markRunningSandboxInstanceStopped(ctx, {
    sandboxInstanceId: sandboxInstance.id,
  });

  return toResponse({
    id: sandboxInstance.id,
    status: SandboxInstanceStatuses.STOPPED,
    failureCode: sandboxInstance.failureCode,
    failureMessage: sandboxInstance.failureMessage,
  });
}

export async function getSandboxInstanceByInspection(
  ctx: GetSandboxInstanceByInspectionContext,
  input: GetSandboxInstanceInput,
): Promise<GetSandboxInstanceResponse> {
  const sandboxInstance = await readSandboxInstanceRecord(ctx, input);
  if (sandboxInstance === undefined) {
    return null;
  }

  if (sandboxInstance.runtimeProvider !== ctx.sandboxProvider) {
    throw new Error(
      `Sandbox instance '${sandboxInstance.id}' runtime provider '${sandboxInstance.runtimeProvider}' does not match configured provider '${ctx.sandboxProvider}'.`,
    );
  }

  if (sandboxInstance.status === SandboxInstanceStatuses.FAILED) {
    return toResponse({
      id: sandboxInstance.id,
      status: SandboxInstanceStatuses.FAILED,
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
    });
  }

  if (sandboxInstance.status === SandboxInstanceStatuses.STOPPED) {
    return toResponse({
      id: sandboxInstance.id,
      status: SandboxInstanceStatuses.STOPPED,
      failureCode: sandboxInstance.failureCode,
      failureMessage: sandboxInstance.failureMessage,
    });
  }

  if (sandboxInstance.status === SandboxInstanceStatuses.STARTING) {
    return inspectStartingSandboxInstance(ctx, sandboxInstance);
  }

  if (sandboxInstance.status === SandboxInstanceStatuses.RUNNING) {
    return inspectRunningSandboxInstance(ctx, sandboxInstance);
  }

  throw new Error("Unsupported sandbox instance status.");
}
