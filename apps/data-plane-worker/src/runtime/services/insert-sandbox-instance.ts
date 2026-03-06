import {
  SandboxInstanceStatuses,
  sandboxInstanceRuntimePlans,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import type { SandboxProvider } from "@mistle/sandbox";
import { and, eq, sql } from "drizzle-orm";

import type {
  EnsureSandboxInstanceInput,
  EnsureSandboxInstanceOutput,
  PersistSandboxInstanceProvisioningInput,
} from "./types.js";

export async function ensureSandboxInstance(
  deps: {
    db: DataPlaneDatabase;
    provider: SandboxProvider;
  },
  input: EnsureSandboxInstanceInput,
): Promise<EnsureSandboxInstanceOutput> {
  const insertedRows = await deps.db
    .insert(sandboxInstances)
    .values({
      id: input.sandboxInstanceId,
      organizationId: input.organizationId,
      sandboxProfileId: input.sandboxProfileId,
      sandboxProfileVersion: input.sandboxProfileVersion,
      provider: deps.provider,
      providerSandboxId: null,
      status: SandboxInstanceStatuses.STARTING,
      startedByKind: input.startedBy.kind,
      startedById: input.startedBy.id,
      source: input.source,
    })
    .onConflictDoNothing({
      target: [sandboxInstances.id],
    })
    .returning({
      id: sandboxInstances.id,
    });

  const insertedSandbox = insertedRows[0];
  if (insertedSandbox !== undefined) {
    return {
      sandboxInstanceId: insertedSandbox.id,
    };
  }

  const restartedStoppedRows = await deps.db
    .update(sandboxInstances)
    .set({
      providerSandboxId: null,
      status: SandboxInstanceStatuses.STARTING,
      startedAt: null,
      stoppedAt: null,
      failedAt: null,
      failureCode: null,
      failureMessage: null,
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

  const restartedStoppedSandbox = restartedStoppedRows[0];
  if (restartedStoppedSandbox !== undefined) {
    return {
      sandboxInstanceId: restartedStoppedSandbox.id,
    };
  }

  const existingStartingSandbox = await deps.db.query.sandboxInstances.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.sandboxInstanceId),
        whereEq(table.status, SandboxInstanceStatuses.STARTING),
      ),
  });

  if (existingStartingSandbox !== undefined) {
    return {
      sandboxInstanceId: existingStartingSandbox.id,
    };
  }

  throw new Error(
    `Sandbox instance '${input.sandboxInstanceId}' could not transition to starting from its current status.`,
  );
}

export async function persistSandboxInstanceProvisioning(
  deps: {
    db: DataPlaneDatabase;
  },
  input: PersistSandboxInstanceProvisioningInput,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const updatedRows = await tx
      .update(sandboxInstances)
      .set({
        providerSandboxId: input.providerSandboxId,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(sandboxInstances.id, input.sandboxInstanceId),
          eq(sandboxInstances.status, SandboxInstanceStatuses.STARTING),
        ),
      )
      .returning({
        id: sandboxInstances.id,
      });

    if (updatedRows[0] === undefined) {
      throw new Error(
        "Failed to persist provider sandbox id while sandbox instance was still starting.",
      );
    }

    await tx
      .insert(sandboxInstanceRuntimePlans)
      .values({
        sandboxInstanceId: input.sandboxInstanceId,
        revision: 1,
        compiledRuntimePlan: input.runtimePlan,
        compiledFromProfileId: input.sandboxProfileId,
        compiledFromProfileVersion: input.sandboxProfileVersion,
      })
      .onConflictDoNothing({
        target: [
          sandboxInstanceRuntimePlans.sandboxInstanceId,
          sandboxInstanceRuntimePlans.revision,
        ],
      });
  });
}
