import type { DataPlaneDatabase } from "@mistle/db/data-plane";
import {
  sandboxInstanceRuntimePlans,
  sandboxInstances,
  type SandboxInstancePersistenceMode,
  SandboxInstanceStatuses,
} from "@mistle/db/data-plane";
import { CompiledRuntimePlanSchema, type CompiledRuntimePlan } from "@mistle/integrations-core";
import { SandboxProvider } from "@mistle/sandbox";
import { and, eq, isNull } from "drizzle-orm";

export type ResumableSandboxInstanceState = {
  sandboxInstanceId: string;
  organizationId: string;
  persistenceMode: SandboxInstancePersistenceMode;
  runtimeProvider: SandboxProvider;
  providerSandboxId: string | null;
  computeGeneration: number;
  runtimePlan: CompiledRuntimePlan;
};

export async function resolveResumableSandboxInstanceState(input: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
}): Promise<ResumableSandboxInstanceState | null> {
  // Resume needs both the persisted sandbox row and the currently active compiled runtime
  // plan. Fetch them together so we validate resume preconditions against one DB snapshot.
  const [sandboxInstance] = await input.db
    .select({
      organizationId: sandboxInstances.organizationId,
      persistenceMode: sandboxInstances.persistenceMode,
      runtimeProvider: sandboxInstances.runtimeProvider,
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
    sandboxInstance.status === SandboxInstanceStatuses.STARTING
  ) {
    return null;
  }

  if (
    sandboxInstance.status !== SandboxInstanceStatuses.STOPPED &&
    sandboxInstance.status !== SandboxInstanceStatuses.FAILED
  ) {
    throw new Error(
      `Expected sandbox instance '${input.sandboxInstanceId}' to be stopped, failed, starting, or running before resume execution.`,
    );
  }

  if (
    sandboxInstance.providerSandboxId === null &&
    sandboxInstance.persistenceMode !== "persistent"
  ) {
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
    persistenceMode: sandboxInstance.persistenceMode,
    runtimeProvider: sandboxInstance.runtimeProvider,
    providerSandboxId: sandboxInstance.providerSandboxId,
    computeGeneration: sandboxInstance.computeGeneration,
    runtimePlan: CompiledRuntimePlanSchema.parse(sandboxInstance.compiledRuntimePlan),
  };
}
