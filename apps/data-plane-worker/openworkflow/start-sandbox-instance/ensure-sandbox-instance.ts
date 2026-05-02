import {
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstancePurpose,
} from "@mistle/db/data-plane";
import type { SandboxProvider } from "@mistle/sandbox";

export async function ensureSandboxInstance(
  ctx: {
    db: DataPlaneDatabase;
    tables: Pick<DataPlaneTables, "sandboxInstances">;
    runtimeProvider: SandboxProvider;
  },
  input: {
    sandboxInstanceId: string;
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    persistenceMode: "ephemeral" | "persistent";
    purpose: SandboxInstancePurpose;
    startedBy: {
      kind: "user" | "system";
      id: string;
    };
    source: "dashboard" | "webhook" | "system";
  },
): Promise<{
  sandboxInstanceId: string;
}> {
  const { sandboxInstances } = ctx.tables;
  const insertedRows = await ctx.db
    .insert(sandboxInstances)
    .values({
      id: input.sandboxInstanceId,
      organizationId: input.organizationId,
      sandboxProfileId: input.sandboxProfileId,
      sandboxProfileVersion: input.sandboxProfileVersion,
      runtimeProvider: ctx.runtimeProvider,
      providerSandboxId: null,
      computeGeneration: 1,
      status: SandboxInstanceStatuses.PENDING,
      startedByKind: input.startedBy.kind,
      startedById: input.startedBy.id,
      source: input.source,
      purpose: input.purpose,
      persistenceMode: input.persistenceMode,
    })
    .onConflictDoNothing({
      target: [sandboxInstances.id],
    })
    .returning({
      id: sandboxInstances.id,
    });

  return {
    sandboxInstanceId: insertedRows[0]?.id ?? input.sandboxInstanceId,
  };
}
