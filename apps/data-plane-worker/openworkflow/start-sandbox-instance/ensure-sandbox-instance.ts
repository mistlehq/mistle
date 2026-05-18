import {
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstancePurpose,
  type SandboxInstanceSource,
} from "@mistle/db/data-plane";
import type { SandboxRuntimeProviderInput } from "@mistle/workflow-registry/data-plane";

export async function ensureSandboxInstance(
  ctx: {
    db: DataPlaneDatabase;
    tables: Pick<DataPlaneTables, "sandboxInstances">;
    sandboxRuntime: SandboxRuntimeProviderInput;
  },
  input: {
    sandboxInstanceId: string;
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    persistenceMode: "ephemeral" | "persistent";
    purpose: SandboxInstancePurpose;
    startedBy: {
      kind: "user" | "api_key" | "system";
      id: string;
    };
    source: SandboxInstanceSource;
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
      runtimeProvider: ctx.sandboxRuntime.provider,
      sandboxConnectionId: ctx.sandboxRuntime.connectionId ?? null,
      sandboxVcpuCount: ctx.sandboxRuntime.resources?.vcpuCount ?? null,
      sandboxMemoryMb: ctx.sandboxRuntime.resources?.memoryMb ?? null,
      sandboxStorageMb: ctx.sandboxRuntime.resources?.storageMb ?? null,
      providerSandboxId: null,
      computeGeneration: 1,
      status: SandboxInstanceStatuses.PENDING,
      startedByKind: input.startedBy.kind,
      startedById: input.startedBy.id,
      source: input.source,
      purpose: input.purpose,
      persistenceMode: input.persistenceMode,
    })
    .onConflictDoUpdate({
      target: [sandboxInstances.id],
      set: {
        runtimeProvider: ctx.sandboxRuntime.provider,
        sandboxConnectionId: ctx.sandboxRuntime.connectionId ?? null,
        sandboxVcpuCount: ctx.sandboxRuntime.resources?.vcpuCount ?? null,
        sandboxMemoryMb: ctx.sandboxRuntime.resources?.memoryMb ?? null,
        sandboxStorageMb: ctx.sandboxRuntime.resources?.storageMb ?? null,
      },
    })
    .returning({
      id: sandboxInstances.id,
    });

  return {
    sandboxInstanceId: insertedRows[0]?.id ?? input.sandboxInstanceId,
  };
}
