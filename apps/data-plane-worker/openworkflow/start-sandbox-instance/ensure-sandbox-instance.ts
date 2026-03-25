import {
  SandboxInstanceStatuses,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import type { SandboxProvider } from "@mistle/sandbox";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";

export async function ensureSandboxInstance(
  ctx: {
    db: DataPlaneDatabase;
    runtimeProvider: SandboxProvider;
  },
  input: {
    sandboxInstanceId: string;
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    startedBy: StartSandboxInstanceWorkflowInput["startedBy"];
    source: StartSandboxInstanceWorkflowInput["source"];
  },
): Promise<{
  sandboxInstanceId: string;
}> {
  const insertedRows = await ctx.db
    .insert(sandboxInstances)
    .values({
      id: input.sandboxInstanceId,
      organizationId: input.organizationId,
      sandboxProfileId: input.sandboxProfileId,
      sandboxProfileVersion: input.sandboxProfileVersion,
      runtimeProvider: ctx.runtimeProvider,
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

  return {
    sandboxInstanceId: insertedRows[0]?.id ?? input.sandboxInstanceId,
  };
}
