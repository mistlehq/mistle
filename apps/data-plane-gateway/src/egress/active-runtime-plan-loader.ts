import type { DataPlaneDatabase, DataPlaneTables } from "@mistle/db/data-plane";
import { CompiledRuntimePlanSchema } from "@mistle/sandbox-runtime-contract";
import { metrics } from "@opentelemetry/api";
import { and, eq, isNull } from "drizzle-orm";

import { logger } from "../logger.js";
import type {
  ActiveSandboxRuntimePlan,
  ActiveSandboxRuntimePlanRepository,
} from "./active-runtime-plan-cache.js";

const ActiveRuntimePlanLoaderMeter = metrics.getMeter("@mistle/data-plane-gateway/egress");
const ActiveRuntimePlanCacheErrors = ActiveRuntimePlanLoaderMeter.createCounter(
  "mistle.gateway.egress.active_runtime_plan.cache_errors",
  {
    description:
      "Active runtime plan cache errors observed while loading gateway egress runtime plans.",
  },
);

export class InvalidActiveSandboxRuntimePlanError extends Error {
  public constructor(
    message: string,
    public readonly details: Omit<ActiveSandboxRuntimePlan, "runtimePlan">,
  ) {
    super(message);
  }
}

export async function loadActiveSandboxRuntimePlan(input: {
  cache: ActiveSandboxRuntimePlanRepository;
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
  tables: DataPlaneTables;
}): Promise<ActiveSandboxRuntimePlan | null> {
  let cachedRuntimePlan: ActiveSandboxRuntimePlan | null = null;
  try {
    cachedRuntimePlan = await input.cache.get({
      sandboxInstanceId: input.sandboxInstanceId,
    });
  } catch (error) {
    ActiveRuntimePlanCacheErrors.add(1, {
      "mistle.cache.operation": "get",
    });
    logger.warn(
      {
        err: error,
        eventName: "gateway.egress.active_runtime_plan_cache_error",
        cacheOperation: "get",
        sandboxInstanceId: input.sandboxInstanceId,
      },
      "Gateway active runtime plan cache read failed; falling back to Postgres",
    );
    // Runtime plans are immutable on a sandbox instance, but Postgres remains the source of truth.
    // Cache read failures should fall through to the DB load path.
  }

  if (cachedRuntimePlan !== null) {
    return cachedRuntimePlan;
  }

  const { sandboxInstanceRuntimePlans, sandboxInstances } = input.tables;
  const rows = await input.db
    .select({
      id: sandboxInstances.id,
      organizationId: sandboxInstances.organizationId,
      providerSandboxId: sandboxInstances.providerSandboxId,
      runtimePlan: {
        compiledRuntimePlan: sandboxInstanceRuntimePlans.compiledRuntimePlan,
        revision: sandboxInstanceRuntimePlans.revision,
      },
      status: sandboxInstances.status,
    })
    .from(sandboxInstances)
    .innerJoin(
      sandboxInstanceRuntimePlans,
      and(
        eq(sandboxInstanceRuntimePlans.sandboxInstanceId, sandboxInstances.id),
        isNull(sandboxInstanceRuntimePlans.supersededAt),
      ),
    )
    .where(eq(sandboxInstances.id, input.sandboxInstanceId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) {
    return null;
  }

  const runtimePlanParseResult = CompiledRuntimePlanSchema.safeParse(
    row.runtimePlan.compiledRuntimePlan,
  );
  if (!runtimePlanParseResult.success) {
    throw new InvalidActiveSandboxRuntimePlanError(runtimePlanParseResult.error.message, {
      organizationId: row.organizationId,
      providerSandboxId: row.providerSandboxId,
      runtimePlanRevision: row.runtimePlan.revision,
      sandboxInstanceStatus: row.status,
    });
  }

  const activeRuntimePlan = {
    organizationId: row.organizationId,
    providerSandboxId: row.providerSandboxId,
    runtimePlan: runtimePlanParseResult.data,
    runtimePlanRevision: row.runtimePlan.revision,
    sandboxInstanceStatus: row.status,
  };
  try {
    await input.cache.set({
      runtimePlan: activeRuntimePlan,
      sandboxInstanceId: input.sandboxInstanceId,
    });
  } catch (error) {
    ActiveRuntimePlanCacheErrors.add(1, {
      "mistle.cache.operation": "set",
    });
    logger.warn(
      {
        err: error,
        eventName: "gateway.egress.active_runtime_plan_cache_error",
        cacheOperation: "set",
        sandboxInstanceId: input.sandboxInstanceId,
      },
      "Gateway active runtime plan cache write failed; returning Postgres-loaded plan",
    );
    // Cache writes are best-effort; the loaded DB result is still valid to return.
  }

  return activeRuntimePlan;
}
