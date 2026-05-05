import {
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import { CompiledRuntimePlanSchema } from "@mistle/integrations-core";
import type { SandboxRuntimeControl } from "@mistle/sandbox";
import { createRuntimePlanEgressGrantByRuleId } from "@mistle/sandbox-egress-auth";
import { and, eq, isNull } from "drizzle-orm";

import type { DataPlaneApiConfig } from "../../../types.js";
import type {
  RefreshSandboxEgressGrantsInput,
  RefreshSandboxEgressGrantsResponse,
} from "../refresh-egress-grants/schema.js";

type RefreshSandboxEgressGrantsContext = {
  config: DataPlaneApiConfig;
  db: DataPlaneDatabase;
  tables: Pick<DataPlaneTables, "sandboxInstances" | "sandboxInstanceRuntimePlans">;
  sandboxRuntimeControl: SandboxRuntimeControl;
};

type ReadSandboxEgressRefreshStateContext = {
  db: DataPlaneDatabase;
  tables: Pick<DataPlaneTables, "sandboxInstances" | "sandboxInstanceRuntimePlans">;
};

export async function readSandboxEgressRefreshState(
  ctx: ReadSandboxEgressRefreshStateContext,
  input: {
    organizationId: string;
    instanceId: string;
  },
) {
  const { sandboxInstanceRuntimePlans, sandboxInstances } = ctx.tables;
  const [sandboxRow] = await ctx.db
    .select({
      sandboxInstance: {
        id: sandboxInstances.id,
        organizationId: sandboxInstances.organizationId,
        providerSandboxId: sandboxInstances.providerSandboxId,
        status: sandboxInstances.status,
      },
      runtimePlan: {
        compiledRuntimePlan: sandboxInstanceRuntimePlans.compiledRuntimePlan,
      },
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
      ),
    )
    .limit(1);

  return sandboxRow;
}

export async function refreshSandboxEgressGrants(
  ctx: RefreshSandboxEgressGrantsContext,
  input: RefreshSandboxEgressGrantsInput,
): Promise<RefreshSandboxEgressGrantsResponse> {
  const sandboxRow = await readSandboxEgressRefreshState(ctx, input);

  if (sandboxRow === undefined) {
    throw new Error(`Sandbox instance '${input.instanceId}' was not found.`);
  }

  const { sandboxInstance } = sandboxRow;
  if (sandboxInstance.status !== SandboxInstanceStatuses.RUNNING) {
    throw new Error(
      `Sandbox instance '${input.instanceId}' is '${sandboxInstance.status}' and cannot refresh egress grants.`,
    );
  }

  if (sandboxInstance.providerSandboxId === null) {
    throw new Error(
      `Sandbox instance '${input.instanceId}' is running without a provider sandbox id.`,
    );
  }

  if (sandboxRow.runtimePlan === null) {
    throw new Error(`Sandbox instance '${input.instanceId}' has no active runtime plan.`);
  }

  const runtimePlan = CompiledRuntimePlanSchema.parse(sandboxRow.runtimePlan.compiledRuntimePlan);
  const egressGrantByRuleId = await createRuntimePlanEgressGrantByRuleId({
    config: {
      tokenSecret: ctx.config.sandbox.egress.tokenSecret,
      tokenIssuer: ctx.config.sandbox.egress.tokenIssuer,
      tokenAudience: ctx.config.sandbox.egress.tokenAudience,
    },
    organizationId: sandboxInstance.organizationId,
    sandboxInstanceId: sandboxInstance.id,
    runtimePlan,
    ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
  });

  await ctx.sandboxRuntimeControl.refreshEgressGrants({
    id: sandboxInstance.providerSandboxId,
    payload: new TextEncoder().encode(`${JSON.stringify({ runtimePlan, egressGrantByRuleId })}\n`),
    env: {
      SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL:
        ctx.config.sandbox.tokenizerProxyEgressBaseUrl,
    },
  });

  return {
    status: "ok",
    sandboxInstanceId: input.instanceId,
  };
}
