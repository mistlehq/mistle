/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { Cache, ValkeyCacheAdapter, closeValkeyClient, createValkeyClient } from "@mistle/cache";
import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import type { CompiledRuntimePlan } from "@mistle/sandbox-runtime-contract";
import {
  type IntegrationTestEnvironment,
  createIntegrationTest,
} from "@mistle/test-harness/integration";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";

import { ActiveSandboxRuntimePlanCache } from "../src/egress/active-runtime-plan-cache.js";
import { loadActiveSandboxRuntimePlan } from "../src/egress/active-runtime-plan-loader.js";

const it = createIntegrationTest({
  services: ["data-plane-gateway"],
});

describe.concurrent("active runtime plan loader integration", () => {
  it("loads the active runtime plan from Postgres when cache access fails", async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    const runtimePlan = createRuntimePlan();
    await insertSandboxInstanceRow({
      env,
      runtimePlan,
      sandboxInstanceId,
    });

    const client = createValkeyClient({
      url: env.dataPlaneGatewayRuntimeState.valkeyUrl,
    });
    await client.connect();
    await closeValkeyClient(client);

    await expect(
      loadActiveSandboxRuntimePlan({
        cache: new ActiveSandboxRuntimePlanCache(
          new Cache({
            adapter: new ValkeyCacheAdapter(client, env.dataPlaneGatewayRuntimeState.keyPrefix),
          }),
        ),
        db: env.dataPlaneDb,
        sandboxInstanceId,
        tables: env.dataPlaneTables,
      }),
    ).resolves.toEqual({
      organizationId: "org_active_runtime_plan_loader",
      providerSandboxId: `provider-${sandboxInstanceId}`,
      runtimePlan,
      runtimePlanRevision: 1,
      sandboxInstanceStatus: SandboxInstanceStatuses.RUNNING,
    });
  });
});

async function insertSandboxInstanceRow(input: {
  env: IntegrationTestEnvironment;
  runtimePlan: CompiledRuntimePlan;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_active_runtime_plan_loader",
    sandboxProfileId: "sbp_active_runtime_plan_loader",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.RUNNING,
    startedByKind: "system",
    startedById: "workflow_active_runtime_plan_loader",
    source: "webhook",
  });

  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstanceRuntimePlans).values({
    sandboxInstanceId: input.sandboxInstanceId,
    revision: 1,
    compiledRuntimePlan: input.runtimePlan,
    compiledFromProfileId: "sbp_active_runtime_plan_loader",
    compiledFromProfileVersion: 1,
  });
}

function createRuntimePlan(): CompiledRuntimePlan {
  return {
    sandboxProfileId: "sbp_active_runtime_plan_loader",
    version: 1,
    image: {
      source: "base",
      imageRef: "sandbox-base",
    },
    egressRoutes: [],
    artifacts: [],
    workspaceSources: [],
    runtimeClients: [],
    agentRuntimes: [],
  };
}
