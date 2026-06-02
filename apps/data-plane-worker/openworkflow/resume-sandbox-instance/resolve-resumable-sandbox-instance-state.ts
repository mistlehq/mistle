import {
  type DataPlaneDatabase,
  type DataPlaneTables,
  SandboxInstanceStatuses,
} from "@mistle/db/data-plane";
import { CompiledRuntimePlanSchema, type CompiledRuntimePlan } from "@mistle/integrations-core";
import { SandboxProvider } from "@mistle/sandbox";
import { and, eq, isNull } from "drizzle-orm";

export type ResumableSandboxInstanceState = {
  sandboxInstanceId: string;
  organizationId: string;
  runtimeProvider: SandboxProvider;
  sandboxConnectionId: string | null;
  sandboxVcpuCount: number | null;
  sandboxMemoryMb: number | null;
  sandboxStorageMb: number | null;
  providerSandboxId: string;
  computeGeneration: number;
  runtimePlan: CompiledRuntimePlan;
};

export async function resolveResumableSandboxInstanceState(input: {
  db: DataPlaneDatabase;
  tables: Pick<DataPlaneTables, "sandboxInstanceRuntimePlans" | "sandboxInstances">;
  sandboxInstanceId: string;
}): Promise<ResumableSandboxInstanceState | null> {
  const { sandboxInstanceRuntimePlans, sandboxInstances } = input.tables;
  // Resume needs both the persisted sandbox row and the currently active compiled runtime
  // plan. Fetch them together so we validate resume preconditions against one DB snapshot.
  const [sandboxInstance] = await input.db
    .select({
      organizationId: sandboxInstances.organizationId,
      runtimeProvider: sandboxInstances.runtimeProvider,
      sandboxConnectionId: sandboxInstances.sandboxConnectionId,
      sandboxVcpuCount: sandboxInstances.sandboxVcpuCount,
      sandboxMemoryMb: sandboxInstances.sandboxMemoryMb,
      sandboxStorageMb: sandboxInstances.sandboxStorageMb,
      providerSandboxId: sandboxInstances.providerSandboxId,
      computeGeneration: sandboxInstances.computeGeneration,
      status: sandboxInstances.status,
      compiledRuntimePlan: sandboxInstanceRuntimePlans.compiledRuntimePlan,
    })
    .from(sandboxInstances)
    .leftJoin(
      sandboxInstanceRuntimePlans,
      and(
        eq(sandboxInstanceRuntimePlans.sandboxInstanceId, sandboxInstances.id),
        isNull(sandboxInstanceRuntimePlans.supersededAt),
      ),
    )
    .where(eq(sandboxInstances.id, input.sandboxInstanceId))
    .limit(1);

  if (sandboxInstance === undefined) {
    throw new Error(`Sandbox instance '${input.sandboxInstanceId}' was not found.`);
  }

  if (
    sandboxInstance.status === SandboxInstanceStatuses.RUNNING ||
    sandboxInstance.status === SandboxInstanceStatuses.STARTING ||
    sandboxInstance.status === SandboxInstanceStatuses.STARTED ||
    sandboxInstance.status === SandboxInstanceStatuses.INITIALIZING
  ) {
    return null;
  }

  if (
    sandboxInstance.status !== SandboxInstanceStatuses.STOPPED &&
    sandboxInstance.status !== SandboxInstanceStatuses.FAILED
  ) {
    throw new Error(
      `Expected sandbox instance '${input.sandboxInstanceId}' to be stopped, failed, or already active before resume execution.`,
    );
  }

  if (sandboxInstance.providerSandboxId === null) {
    throw new Error(
      `Expected resumable sandbox instance '${input.sandboxInstanceId}' to have a provider sandbox id.`,
    );
  }

  if (sandboxInstance.compiledRuntimePlan === null) {
    throw new Error(
      `Expected resumable sandbox instance '${input.sandboxInstanceId}' to have an active compiled runtime plan.`,
    );
  }

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    organizationId: sandboxInstance.organizationId,
    runtimeProvider: sandboxInstance.runtimeProvider,
    sandboxConnectionId: sandboxInstance.sandboxConnectionId,
    sandboxVcpuCount: sandboxInstance.sandboxVcpuCount,
    sandboxMemoryMb: sandboxInstance.sandboxMemoryMb,
    sandboxStorageMb: sandboxInstance.sandboxStorageMb,
    providerSandboxId: sandboxInstance.providerSandboxId,
    computeGeneration: sandboxInstance.computeGeneration,
    runtimePlan: CompiledRuntimePlanSchema.parse(sandboxInstance.compiledRuntimePlan),
  };
}
