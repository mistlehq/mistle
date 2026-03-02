import {
  SandboxInstanceStatuses,
  sandboxInstanceRuntimePlans,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";

import type { CreateSandboxInstanceInput, CreateSandboxInstanceOutput } from "./types.js";

export async function insertSandboxInstance(
  deps: {
    db: DataPlaneDatabase;
  },
  input: CreateSandboxInstanceInput,
): Promise<CreateSandboxInstanceOutput> {
  return deps.db.transaction(async (tx) => {
    const insertedRows = await tx
      .insert(sandboxInstances)
      .values({
        organizationId: input.organizationId,
        sandboxProfileId: input.sandboxProfileId,
        sandboxProfileVersion: input.sandboxProfileVersion,
        provider: input.provider,
        providerSandboxId: input.providerSandboxId,
        status: SandboxInstanceStatuses.STARTING,
        startedByKind: input.startedBy.kind,
        startedById: input.startedBy.id,
        source: input.source,
      })
      .returning({
        id: sandboxInstances.id,
      });

    const sandboxInstance = insertedRows[0];
    if (sandboxInstance === undefined) {
      throw new Error("Failed to insert sandbox instance row.");
    }

    await tx.insert(sandboxInstanceRuntimePlans).values({
      sandboxInstanceId: sandboxInstance.id,
      revision: 1,
      compiledRuntimePlan: input.runtimePlan,
      compiledFromProfileId: input.sandboxProfileId,
      compiledFromProfileVersion: input.sandboxProfileVersion,
    });

    return {
      sandboxInstanceId: sandboxInstance.id,
    };
  });
}
