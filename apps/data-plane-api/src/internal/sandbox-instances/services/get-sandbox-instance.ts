import type { DataPlaneDatabase } from "@mistle/db/data-plane";
import {
  SandboxInstancePurposes,
  sandboxInstanceRuntimePlans,
  sandboxInstances,
} from "@mistle/db/data-plane";
import { CompiledRuntimePlanSchema } from "@mistle/integrations-core";
import { and, eq, isNull } from "drizzle-orm";

import type { AppRuntimeResources } from "../../../resources.js";
import type {
  GetSandboxInstanceInput,
  GetSandboxInstanceResponse,
} from "../get-sandbox-instance/schema.js";
import { readEffectiveSandboxStatus } from "./read-effective-sandbox-status.js";

type GetSandboxInstanceContext = {
  db: DataPlaneDatabase;
  runtimeStateReader: AppRuntimeResources["runtimeStateReader"];
};

export async function getSandboxInstance(
  ctx: GetSandboxInstanceContext,
  input: GetSandboxInstanceInput,
): Promise<GetSandboxInstanceResponse> {
  const [sandboxInstance] = await ctx.db
    .select({
      id: sandboxInstances.id,
      title: sandboxInstances.title,
      status: sandboxInstances.status,
      failureCode: sandboxInstances.failureCode,
      failureMessage: sandboxInstances.failureMessage,
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
    .where(
      and(
        eq(sandboxInstances.id, input.instanceId),
        eq(sandboxInstances.organizationId, input.organizationId),
        eq(sandboxInstances.purpose, SandboxInstancePurposes.SESSION),
      ),
    )
    .limit(1);

  if (sandboxInstance === undefined) {
    return null;
  }

  const status = await readEffectiveSandboxStatus(
    {
      runtimeStateReader: ctx.runtimeStateReader,
    },
    {
      sandboxInstanceId: sandboxInstance.id,
      persistedStatus: sandboxInstance.status,
    },
  );

  return {
    id: sandboxInstance.id,
    title: sandboxInstance.title,
    status,
    connectable: status === "running",
    failureCode: sandboxInstance.failureCode,
    failureMessage: sandboxInstance.failureMessage,
    runtimePlan:
      sandboxInstance.compiledRuntimePlan === null
        ? null
        : CompiledRuntimePlanSchema.parse(sandboxInstance.compiledRuntimePlan),
  };
}
