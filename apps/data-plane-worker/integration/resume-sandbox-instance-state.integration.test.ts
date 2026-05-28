/* eslint-disable jest/no-standalone-expect --
 * The test cases use an extended Vitest fixture created by the test harness.
 */

import {
  SandboxInstancePersistenceModes,
  SandboxInstanceSources,
  type SandboxInstanceStatus,
  SandboxInstanceStatuses,
  SandboxStopReasons,
} from "@mistle/db/data-plane";
import { SandboxLifecycleEvents } from "@mistle/sandbox-lifecycle";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { persistSandboxInstanceComputeReplacement } from "../openworkflow/resume-sandbox-instance/persist-sandbox-instance-compute-replacement.js";
import { resolveResumableSandboxInstanceState } from "../openworkflow/resume-sandbox-instance/resolve-resumable-sandbox-instance-state.js";
import { revertSandboxInstanceComputeReplacement } from "../openworkflow/resume-sandbox-instance/revert-sandbox-instance-compute-replacement.js";
import { applySandboxLifecycleEvent } from "../openworkflow/shared/apply-sandbox-lifecycle-event.js";
import { markSandboxInstanceStarting } from "../openworkflow/shared/mark-sandbox-instance-starting.js";

const it = createIntegrationTest({
  services: ["data-plane-worker"],
});

describe.concurrent("data-plane worker resume sandbox instance state", () => {
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
      persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
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
      persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
      runtimeProvider: "docker",
      sandboxConnectionId: null,
      sandboxVcpuCount: null,
      sandboxMemoryMb: null,
      sandboxStorageMb: null,
      providerSandboxId: "provider-runtime-plan-new",
      computeGeneration: 1,
      runtimePlan: createRuntimePlan({
        sandboxProfileId: "sbp_resume_state_runtime_plan_new",
        version: 2,
      }),
    });
  });

  it("allows a persistent sandbox instance without provider compute to remain resumable", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_resume_state_missing_provider_persistent_new";

    await insertStoppedSandboxInstance(env, {
      sandboxInstanceId,
      organizationId: "org_resume_state_missing_provider_persistent_new",
      sandboxProfileId: "sbp_resume_state_missing_provider_persistent_new",
      sandboxProfileVersion: 1,
      providerSandboxId: null,
      persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
    });
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceRuntimePlans).values({
      sandboxInstanceId,
      revision: 1,
      compiledRuntimePlan: createRuntimePlan({
        sandboxProfileId: "sbp_resume_state_missing_provider_persistent_new",
        version: 1,
      }),
      compiledFromProfileId: "sbp_resume_state_missing_provider_persistent_new",
      compiledFromProfileVersion: 1,
    });

    await expect(
      resolveResumableSandboxInstanceState({
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
        sandboxInstanceId,
      }),
    ).resolves.toEqual({
      sandboxInstanceId,
      organizationId: "org_resume_state_missing_provider_persistent_new",
      persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
      runtimeProvider: "docker",
      sandboxConnectionId: null,
      sandboxVcpuCount: null,
      sandboxMemoryMb: null,
      sandboxStorageMb: null,
      providerSandboxId: null,
      computeGeneration: 1,
      runtimePlan: createRuntimePlan({
        sandboxProfileId: "sbp_resume_state_missing_provider_persistent_new",
        version: 1,
      }),
    });
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
      persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
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
      persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
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

  it("persists replacement compute as started and treats replayed persistence as idempotent", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_resume_replacement_started_idempotent_new";

    await insertStoppedSandboxInstance(env, {
      sandboxInstanceId,
      organizationId: "org_resume_replacement_started_idempotent_new",
      sandboxProfileId: "sbp_resume_replacement_started_idempotent_new",
      sandboxProfileVersion: 1,
      providerSandboxId: "provider-runtime-old-idempotent-new",
      persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
    });
    await markSandboxInstanceStarting({
      db: env.dataPlaneDb,
      tables: env.dataPlaneTables,
      sandboxInstanceId,
    });

    await expect(
      persistSandboxInstanceComputeReplacement(
        {
          db: env.dataPlaneDb,
          tables: env.dataPlaneTables,
        },
        {
          sandboxInstanceId,
          providerSandboxId: "provider-runtime-replacement-idempotent-new",
          previousComputeGeneration: 1,
        },
      ),
    ).resolves.toEqual({ computeGeneration: 2 });

    await expect(
      persistSandboxInstanceComputeReplacement(
        {
          db: env.dataPlaneDb,
          tables: env.dataPlaneTables,
        },
        {
          sandboxInstanceId,
          providerSandboxId: "provider-runtime-replacement-idempotent-new",
          previousComputeGeneration: 1,
        },
      ),
    ).resolves.toEqual({ computeGeneration: 2 });

    const sandboxInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      columns: {
        status: true,
        providerSandboxId: true,
        computeGeneration: true,
      },
      where: (table, { eq }) => eq(table.id, sandboxInstanceId),
    });

    expect(sandboxInstance).toEqual({
      status: SandboxInstanceStatuses.STARTED,
      providerSandboxId: "provider-runtime-replacement-idempotent-new",
      computeGeneration: 2,
    });
  });

  it("rejects replayed replacement persistence when started metadata does not match", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_resume_replacement_started_conflict_new";

    await insertStoppedSandboxInstance(env, {
      sandboxInstanceId,
      organizationId: "org_resume_replacement_started_conflict_new",
      sandboxProfileId: "sbp_resume_replacement_started_conflict_new",
      sandboxProfileVersion: 1,
      providerSandboxId: "provider-runtime-old-conflict-new",
      persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
    });
    await markSandboxInstanceStarting({
      db: env.dataPlaneDb,
      tables: env.dataPlaneTables,
      sandboxInstanceId,
    });
    await persistSandboxInstanceComputeReplacement(
      {
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
      },
      {
        sandboxInstanceId,
        providerSandboxId: "provider-runtime-replacement-conflict-new",
        previousComputeGeneration: 1,
      },
    );

    await expect(
      persistSandboxInstanceComputeReplacement(
        {
          db: env.dataPlaneDb,
          tables: env.dataPlaneTables,
        },
        {
          sandboxInstanceId,
          providerSandboxId: "provider-runtime-other-conflict-new",
          previousComputeGeneration: 1,
        },
      ),
    ).rejects.toThrow(
      "Failed to persist replacement provider sandbox id while sandbox instance was still starting.",
    );
  });

  it("reverts replacement compute from started and initializing states", async ({ env }) => {
    const replacementStatuses = [
      SandboxInstanceStatuses.STARTED,
      SandboxInstanceStatuses.INITIALIZING,
    ];

    for (const status of replacementStatuses) {
      const sandboxInstanceId = `sbi_resume_replacement_revert_${status}_new`;

      await insertStoppedSandboxInstance(env, {
        sandboxInstanceId,
        organizationId: `org_resume_replacement_revert_${status}_new`,
        sandboxProfileId: `sbp_resume_replacement_revert_${status}_new`,
        sandboxProfileVersion: 1,
        providerSandboxId: `provider-runtime-previous-revert-${status}-new`,
        persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
      });
      await markSandboxInstanceStarting({
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
        sandboxInstanceId,
      });
      const persistedReplacement = await persistSandboxInstanceComputeReplacement(
        {
          db: env.dataPlaneDb,
          tables: env.dataPlaneTables,
        },
        {
          sandboxInstanceId,
          providerSandboxId: `provider-runtime-replacement-revert-${status}-new`,
          previousComputeGeneration: 1,
        },
      );

      if (status === SandboxInstanceStatuses.INITIALIZING) {
        await applySandboxLifecycleEvent(
          {
            db: env.dataPlaneDb,
            tables: env.dataPlaneTables,
          },
          {
            sandboxInstanceId,
            event: SandboxLifecycleEvents.PROVIDER_RUNTIME_INITIALIZATION_STARTED,
          },
        );
      }

      await revertSandboxInstanceComputeReplacement(
        {
          db: env.dataPlaneDb,
          tables: env.dataPlaneTables,
        },
        {
          sandboxInstanceId,
          replacementProviderSandboxId: `provider-runtime-replacement-revert-${status}-new`,
          replacementComputeGeneration: persistedReplacement.computeGeneration,
          previousProviderSandboxId: `provider-runtime-previous-revert-${status}-new`,
          previousComputeGeneration: 1,
        },
      );

      const sandboxInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
        columns: {
          status: true,
          providerSandboxId: true,
          computeGeneration: true,
        },
        where: (table, { eq }) => eq(table.id, sandboxInstanceId),
      });

      expect(sandboxInstance).toEqual({
        status: SandboxInstanceStatuses.STARTING,
        providerSandboxId: `provider-runtime-previous-revert-${status}-new`,
        computeGeneration: 1,
      });
    }
  });

  it("does not revert replacement metadata for a deleted sandbox instance", async ({ env }) => {
    const sandboxInstanceId = "sbi_resume_replacement_revert_deleted_new";

    await insertStoppedSandboxInstance(env, {
      sandboxInstanceId,
      organizationId: "org_resume_replacement_revert_deleted_new",
      sandboxProfileId: "sbp_resume_replacement_revert_deleted_new",
      sandboxProfileVersion: 1,
      providerSandboxId: "provider-runtime-previous-revert-deleted-new",
      persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
    });
    await markSandboxInstanceStarting({
      db: env.dataPlaneDb,
      tables: env.dataPlaneTables,
      sandboxInstanceId,
    });
    const persistedReplacement = await persistSandboxInstanceComputeReplacement(
      {
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
      },
      {
        sandboxInstanceId,
        providerSandboxId: "provider-runtime-replacement-revert-deleted-new",
        previousComputeGeneration: 1,
      },
    );
    await env.dataPlaneDb
      .update(env.dataPlaneTables.sandboxInstances)
      .set({
        deletedAt: "2026-05-19T00:00:00.000Z",
      })
      .where(eq(env.dataPlaneTables.sandboxInstances.id, sandboxInstanceId));

    await expect(
      revertSandboxInstanceComputeReplacement(
        {
          db: env.dataPlaneDb,
          tables: env.dataPlaneTables,
        },
        {
          sandboxInstanceId,
          replacementProviderSandboxId: "provider-runtime-replacement-revert-deleted-new",
          replacementComputeGeneration: persistedReplacement.computeGeneration,
          previousProviderSandboxId: "provider-runtime-previous-revert-deleted-new",
          previousComputeGeneration: 1,
        },
      ),
    ).rejects.toThrow(
      "Failed to revert replacement provider sandbox id while sandbox instance was still starting.",
    );

    const sandboxInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      columns: {
        status: true,
        providerSandboxId: true,
        computeGeneration: true,
      },
      where: (table, { eq }) => eq(table.id, sandboxInstanceId),
    });
    expect(sandboxInstance).toEqual({
      status: SandboxInstanceStatuses.STARTED,
      providerSandboxId: "provider-runtime-replacement-revert-deleted-new",
      computeGeneration: 2,
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
    persistenceMode: (typeof SandboxInstancePersistenceModes)[keyof typeof SandboxInstancePersistenceModes];
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
    persistenceMode: input.persistenceMode,
    startedByKind: "system",
    startedById: "worker_resume_state_integration_new",
    source: SandboxInstanceSources.DASHBOARD,
    stoppedAt: input.stoppedAt,
    stopReason: input.stopReason,
  });
}
