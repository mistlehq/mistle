/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { sql } from "drizzle-orm";
import { describe, expect } from "vitest";

import { readSandboxEgressRefreshState } from "../src/internal/sandbox-instances/services/refresh-sandbox-egress-grants.js";

const it = createIntegrationTest({
  services: ["data-plane-api"],
});

describe.concurrent("internal sandbox instance egress refresh integration", () => {
  it("reads the running sandbox and active runtime plan in one joined query", async ({ env }) => {
    const sandboxInstanceId = "sbi_egress_refresh_read_active_plan";
    const organizationId = "org_egress_refresh_read_active_plan";
    const supersededRuntimePlan = runtimePlan({
      sandboxProfileId: "sbp_egress_refresh_read_active_plan",
      version: 1,
      imageRef: "registry:old",
    });
    const activeRuntimePlan = runtimePlan({
      sandboxProfileId: "sbp_egress_refresh_read_active_plan",
      version: 2,
      imageRef: "registry:new",
    });

    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId,
      sandboxProfileId: "sbp_egress_refresh_read_active_plan",
      sandboxProfileVersion: 2,
      runtimeProvider: "docker",
      providerSandboxId: "provider-egress-refresh-read-active-plan",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "system",
      startedById: "workflow_egress_refresh_read_active_plan",
      source: "webhook",
    });
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceRuntimePlans).values([
      {
        sandboxInstanceId,
        revision: 1,
        compiledRuntimePlan: supersededRuntimePlan,
        compiledFromProfileId: "sbp_egress_refresh_read_active_plan",
        compiledFromProfileVersion: 1,
        supersededAt: sql`now()`,
      },
      {
        sandboxInstanceId,
        revision: 2,
        compiledRuntimePlan: activeRuntimePlan,
        compiledFromProfileId: "sbp_egress_refresh_read_active_plan",
        compiledFromProfileVersion: 2,
      },
    ]);

    await expect(
      readSandboxEgressRefreshState(
        {
          db: env.dataPlaneDb,
          tables: env.dataPlaneTables,
        },
        {
          organizationId,
          instanceId: sandboxInstanceId,
        },
      ),
    ).resolves.toEqual({
      sandboxInstance: {
        id: sandboxInstanceId,
        organizationId,
        providerSandboxId: "provider-egress-refresh-read-active-plan",
        status: SandboxInstanceStatuses.RUNNING,
      },
      runtimePlan: {
        compiledRuntimePlan: activeRuntimePlan,
      },
    });
  });

  it("returns the sandbox with a null runtime plan when no active runtime plan exists", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_egress_refresh_read_missing_plan";
    const organizationId = "org_egress_refresh_read_missing_plan";

    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId,
      sandboxProfileId: "sbp_egress_refresh_read_missing_plan",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-egress-refresh-read-missing-plan",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "system",
      startedById: "workflow_egress_refresh_read_missing_plan",
      source: "webhook",
    });

    await expect(
      readSandboxEgressRefreshState(
        {
          db: env.dataPlaneDb,
          tables: env.dataPlaneTables,
        },
        {
          organizationId,
          instanceId: sandboxInstanceId,
        },
      ),
    ).resolves.toEqual({
      sandboxInstance: {
        id: sandboxInstanceId,
        organizationId,
        providerSandboxId: "provider-egress-refresh-read-missing-plan",
        status: SandboxInstanceStatuses.RUNNING,
      },
      runtimePlan: null,
    });
  });
});

function runtimePlan(input: {
  sandboxProfileId: string;
  version: number;
  imageRef: string;
}): CompiledRuntimePlan {
  return {
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    image: {
      source: "base",
      imageRef: input.imageRef,
    },
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: [],
    agentRuntimes: [],
  };
}
