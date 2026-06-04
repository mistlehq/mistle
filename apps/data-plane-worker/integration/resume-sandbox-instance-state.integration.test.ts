/* eslint-disable jest/no-standalone-expect --
 * The test cases use an extended Vitest fixture created by the test harness.
 */

import {
  SandboxInstanceSources,
  type SandboxInstanceStatus,
  SandboxInstanceStatuses,
  SandboxStopReasons,
} from "@mistle/db/data-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import {
  ResumeSandboxInstanceWorkflowSpec,
  type StartSandboxInstanceWorkflowInput,
} from "@mistle/workflow-registry/data-plane";
import { describe, expect } from "vitest";

import { resolveResumableSandboxInstanceState } from "../openworkflow/resume-sandbox-instance/resolve-resumable-sandbox-instance-state.js";
import { markSandboxInstanceStarting } from "../openworkflow/shared/mark-sandbox-instance-starting.js";

const it = createIntegrationTest({
  services: ["data-plane-worker"],
});

describe.concurrent("data-plane worker resume sandbox instance state", () => {
  it("marks a sandbox failed when provider preflight inspection fails after resume starts", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_resume_preflight_failure_new";

    await insertStoppedSandboxInstance(env, {
      sandboxInstanceId,
      organizationId: "org_resume_preflight_failure_new",
      sandboxProfileId: "sbp_resume_preflight_failure_new",
      sandboxProfileVersion: 1,
      providerSandboxId: "invalid docker id with spaces",
    });
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceRuntimePlans).values({
      sandboxInstanceId,
      revision: 1,
      compiledRuntimePlan: createRuntimePlan({
        sandboxProfileId: "sbp_resume_preflight_failure_new",
        version: 1,
      }),
      compiledFromProfileId: "sbp_resume_preflight_failure_new",
      compiledFromProfileVersion: 1,
    });

    const handle = await env.dataPlaneWorkflow.runWorkflow(ResumeSandboxInstanceWorkflowSpec, {
      sandboxInstanceId,
    });

    await expect(handle.result({ timeoutMs: 15_000 })).rejects.toThrow(
      "Resume failure handling failed.",
    );

    const sandboxInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      columns: {
        status: true,
        stopReason: true,
        failureCode: true,
        failureMessage: true,
      },
      where: (table, { eq }) => eq(table.id, sandboxInstanceId),
    });

    expect(sandboxInstance).toEqual({
      status: SandboxInstanceStatuses.FAILED,
      stopReason: SandboxStopReasons.FAILED,
      failureCode: "resume_sandbox_failed",
      failureMessage: expect.stringContaining(
        "Failed to inspect sandbox provider runtime before resume.",
      ),
    });
  });

  it("resolves the active compiled runtime plan for a resumable sandbox instance", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_resume_state_runtime_plan_new";

    await insertStoppedSandboxInstance(env, {
      sandboxInstanceId,
      organizationId: "org_resume_state_runtime_plan_new",
      sandboxProfileId: "sbp_resume_state_runtime_plan_new",
      sandboxProfileVersion: 2,
      providerSandboxId: "provider-runtime-plan-new",
    });

    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceRuntimePlans).values([
      {
        sandboxInstanceId,
        revision: 1,
        compiledRuntimePlan: createRuntimePlan({
          sandboxProfileId: "sbp_resume_state_runtime_plan_new",
          version: 1,
        }),
        compiledFromProfileId: "sbp_resume_state_runtime_plan_new",
        compiledFromProfileVersion: 1,
        supersededAt: "2026-03-18T00:00:00.000Z",
      },
      {
        sandboxInstanceId,
        revision: 2,
        compiledRuntimePlan: createRuntimePlan({
          sandboxProfileId: "sbp_resume_state_runtime_plan_new",
          version: 2,
        }),
        compiledFromProfileId: "sbp_resume_state_runtime_plan_new",
        compiledFromProfileVersion: 2,
      },
    ]);

    await expect(
      resolveResumableSandboxInstanceState({
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
        sandboxInstanceId,
      }),
    ).resolves.toEqual({
      sandboxInstanceId,
      organizationId: "org_resume_state_runtime_plan_new",
      runtimeProvider: "docker",
      sandboxConnectionId: null,
      sandboxVcpuCount: null,
      sandboxMemoryMb: null,
      sandboxDiskMb: null,
      providerSandboxId: "provider-runtime-plan-new",
      computeGeneration: 1,
      runtimePlan: createRuntimePlan({
        sandboxProfileId: "sbp_resume_state_runtime_plan_new",
        version: 2,
      }),
    });
  });

  it("fails fast when a resumable sandbox instance has no provider runtime id", async ({ env }) => {
    const sandboxInstanceId = "sbi_resume_state_missing_provider_runtime_new";

    await insertStoppedSandboxInstance(env, {
      sandboxInstanceId,
      organizationId: "org_resume_state_missing_provider_runtime_new",
      sandboxProfileId: "sbp_resume_state_missing_provider_runtime_new",
      sandboxProfileVersion: 1,
      providerSandboxId: null,
    });
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceRuntimePlans).values({
      sandboxInstanceId,
      revision: 1,
      compiledRuntimePlan: createRuntimePlan({
        sandboxProfileId: "sbp_resume_state_missing_provider_runtime_new",
        version: 1,
      }),
      compiledFromProfileId: "sbp_resume_state_missing_provider_runtime_new",
      compiledFromProfileVersion: 1,
    });

    await expect(
      resolveResumableSandboxInstanceState({
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
        sandboxInstanceId,
      }),
    ).rejects.toThrow(
      `Expected resumable sandbox instance '${sandboxInstanceId}' to have a provider sandbox id.`,
    );
  });

  it("fails fast when a resumable sandbox instance has no active compiled runtime plan", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_resume_state_missing_runtime_plan_new";

    await insertStoppedSandboxInstance(env, {
      sandboxInstanceId,
      organizationId: "org_resume_state_missing_runtime_plan_new",
      sandboxProfileId: "sbp_resume_state_missing_runtime_plan_new",
      sandboxProfileVersion: 1,
      providerSandboxId: "provider-runtime-missing-plan-new",
    });

    await expect(
      resolveResumableSandboxInstanceState({
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
        sandboxInstanceId,
      }),
    ).rejects.toThrow(
      `Expected resumable sandbox instance '${sandboxInstanceId}' to have an active compiled runtime plan.`,
    );
  });

  it("treats in-progress startup statuses as already active for resume", async ({ env }) => {
    const activeStatuses: SandboxInstanceStatus[] = [
      SandboxInstanceStatuses.STARTING,
      SandboxInstanceStatuses.STARTED,
      SandboxInstanceStatuses.INITIALIZING,
      SandboxInstanceStatuses.RUNNING,
    ];

    for (const status of activeStatuses) {
      const sandboxInstanceId = `sbi_resume_state_active_${status}_new`;

      await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
        id: sandboxInstanceId,
        organizationId: `org_resume_state_active_${status}_new`,
        sandboxProfileId: `sbp_resume_state_active_${status}_new`,
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: `provider-runtime-active-${status}-new`,
        status,
        startedByKind: "system",
        startedById: "worker_resume_state_active_new",
        source: SandboxInstanceSources.DASHBOARD,
      });
      await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceRuntimePlans).values({
        sandboxInstanceId,
        revision: 1,
        compiledRuntimePlan: createRuntimePlan({
          sandboxProfileId: `sbp_resume_state_active_${status}_new`,
          version: 1,
        }),
        compiledFromProfileId: `sbp_resume_state_active_${status}_new`,
        compiledFromProfileVersion: 1,
      });

      await expect(
        resolveResumableSandboxInstanceState({
          db: env.dataPlaneDb,
          tables: env.dataPlaneTables,
          sandboxInstanceId,
        }),
      ).resolves.toBeNull();
    }
  });

  it("transitions a stopped sandbox instance back to starting while preserving the provider sandbox id", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_resume_state_integration_new";

    await insertStoppedSandboxInstance(env, {
      sandboxInstanceId,
      organizationId: "org_resume_state_integration_new",
      sandboxProfileId: "sbp_resume_state_integration_new",
      sandboxProfileVersion: 1,
      providerSandboxId: "provider-runtime-old-new",
      stoppedAt: "2026-03-18T00:03:00.000Z",
      stopReason: SandboxStopReasons.DISCONNECTED,
    });

    await markSandboxInstanceStarting({
      db: env.dataPlaneDb,
      tables: env.dataPlaneTables,
      sandboxInstanceId,
    });

    const startingSandboxInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      columns: {
        status: true,
        providerSandboxId: true,
        stoppedAt: true,
        stopReason: true,
        failureCode: true,
        failureMessage: true,
      },
      where: (table, { eq }) => eq(table.id, sandboxInstanceId),
    });

    expect(startingSandboxInstance).toEqual({
      status: SandboxInstanceStatuses.STARTING,
      providerSandboxId: "provider-runtime-old-new",
      stoppedAt: null,
      stopReason: null,
      failureCode: null,
      failureMessage: null,
    });
  });

  it("transitions a failed sandbox instance back to starting and clears stale failure state", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_resume_failed_state_integration_new";

    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: "org_resume_failed_state_integration_new",
      sandboxProfileId: "sbp_resume_failed_state_integration_new",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-runtime-failed-new",
      status: SandboxInstanceStatuses.FAILED,
      startedByKind: "system",
      startedById: "worker_resume_failed_state_integration_new",
      source: SandboxInstanceSources.DASHBOARD,
      stopReason: SandboxStopReasons.FAILED,
      failedAt: "2026-03-18T00:03:00.000Z",
      failureCode: "resume_failed_state",
      failureMessage: "Sandbox failed before retry.",
    });

    await markSandboxInstanceStarting({
      db: env.dataPlaneDb,
      tables: env.dataPlaneTables,
      sandboxInstanceId,
    });

    const startingSandboxInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      columns: {
        status: true,
        providerSandboxId: true,
        stoppedAt: true,
        stopReason: true,
        failedAt: true,
        failureCode: true,
        failureMessage: true,
      },
      where: (table, { eq }) => eq(table.id, sandboxInstanceId),
    });

    expect(startingSandboxInstance).toEqual({
      status: SandboxInstanceStatuses.STARTING,
      providerSandboxId: "provider-runtime-failed-new",
      stoppedAt: null,
      stopReason: null,
      failedAt: null,
      failureCode: null,
      failureMessage: null,
    });
  });
});

function createRuntimePlan(input: {
  sandboxProfileId: string;
  version: number;
}): StartSandboxInstanceWorkflowInput["runtimePlan"] {
  return {
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    image: {
      source: "base",
      imageRef: "registry:resume",
    },
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: [],
    agentRuntimes: [],
  };
}

async function insertStoppedSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    sandboxInstanceId: string;
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    providerSandboxId: string | null;
    stoppedAt?: string;
    stopReason?: (typeof SandboxStopReasons)[keyof typeof SandboxStopReasons];
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
    runtimeProvider: "docker",
    providerSandboxId: input.providerSandboxId,
    status: SandboxInstanceStatuses.STOPPED,
    startedByKind: "system",
    startedById: "worker_resume_state_integration_new",
    source: SandboxInstanceSources.DASHBOARD,
    stoppedAt: input.stoppedAt,
    stopReason: input.stopReason,
  });
}
