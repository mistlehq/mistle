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

  const ensuredSandboxInstanceId = insertedRows[0]?.id ?? input.sandboxInstanceId;

  return {
    sandboxInstanceId: ensuredSandboxInstanceId,
  };
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
