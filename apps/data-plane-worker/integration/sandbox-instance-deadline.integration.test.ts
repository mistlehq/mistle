/* eslint-disable jest/no-standalone-expect --
 * The test cases use an extended Vitest fixture created by the test harness.
 */

import {
  SandboxInstanceDeadlineKinds,
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxInstanceStatuses,
  SandboxStopReasons,
} from "@mistle/db/data-plane";
import {
  SandboxInspectDispositions,
  SandboxInspectStates,
  SandboxProvider,
  createTransparentProxyConfiguration,
  type SandboxAdapter,
  type SandboxRuntimeControl,
} from "@mistle/sandbox";
import { SandboxLifecycleEvents } from "@mistle/sandbox-lifecycle";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import type { Clock } from "@mistle/time";
import { HandleSandboxInstanceDeadlineWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { describe, expect } from "vitest";

import { logger as dataPlaneWorkerLogger } from "../logger.js";
import { markSandboxInstanceFailed as markSandboxInstanceFailedDuringReconcile } from "../openworkflow/reconcile-sandbox-instance/mark-sandbox-instance-failed.js";
import { markSandboxInstanceStopped as markSandboxInstanceStoppedDuringReconcile } from "../openworkflow/reconcile-sandbox-instance/mark-sandbox-instance-stopped.js";
import { applySandboxLifecycleEvent } from "../openworkflow/shared/apply-sandbox-lifecycle-event.js";
import { createWorkerSandboxLifecycleEventRecorder } from "../openworkflow/shared/sandbox-operation-events.js";
import { markSandboxInstanceFailed as markSandboxInstanceFailedDuringStart } from "../openworkflow/start-sandbox-instance/mark-sandbox-instance-failed.js";
import { markSandboxInstanceStopped as markSandboxInstanceStoppedDuringStop } from "../openworkflow/stop-sandbox-instance/mark-sandbox-instance-stopped.js";
import { stopSandboxInstance } from "../openworkflow/stop-sandbox-instance/stop-sandbox-instance.js";
import type {
  SandboxRuntimeStateReader,
  SandboxRuntimeStateSnapshot,
} from "../runtime-state/sandbox-runtime-state-reader.js";

const it = createIntegrationTest({
  services: ["data-plane-worker"],
});

const MatchingDeadlineDueAt = "2026-04-14T12:00:00.000Z";
const AlternateDeadlineDueAt = "2026-04-14T12:05:00.000Z";

type DeadlineWorkflowInput = {
  sandboxInstanceId: string;
  kind: typeof SandboxInstanceDeadlineKinds.IDLE | typeof SandboxInstanceDeadlineKinds.DISCONNECT;
  ownerLeaseId: string;
  dueAt: string;
  generation: number;
};

describe.concurrent("data-plane worker sandbox instance deadlines", () => {
  it("processes deadline workflows through the hosted worker runtime", async ({ env }) => {
    const sandboxInstanceId = "sbi_integration_new_deadline_generation";
    const ownerLeaseId = "lease_integration_new_deadline_generation";
    const dueAt = "2026-05-01T12:00:00.000Z";

    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: "org_integration_new_deadline_generation",
      sandboxProfileId: "sbp_integration_new_deadline_generation",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider_integration_new_deadline_generation",
      status: SandboxInstanceStatuses.RUNNING,
      purpose: SandboxInstancePurposes.SESSION,
      startedByKind: "system",
      startedById: "worker_integration_new_deadline_generation",
      source: SandboxInstanceSources.DASHBOARD,
    });
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceDeadlines).values({
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      ownerLeaseId,
      dueAt,
      generation: 2,
      clearedAt: null,
    });

    const handle = await env.dataPlaneWorkflow.runWorkflow(
      HandleSandboxInstanceDeadlineWorkflowSpec,
      {
        sandboxInstanceId,
        kind: SandboxInstanceDeadlineKinds.IDLE,
        ownerLeaseId,
        dueAt,
        generation: 1,
      },
    );
    const result = await handle.result({
      timeoutMs: 15_000,
    });

    expect(result).toEqual({
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      executed: false,
      outcome: "deadline_generation_mismatch",
    });

    const operationEvents = await env.dataPlaneDb.query.sandboxOperationEvents.findMany({
      columns: {
        operationKind: true,
        operationId: true,
        sequence: true,
        source: true,
        phase: true,
        status: true,
        message: true,
        attributes: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxInstanceId, sandboxInstanceId), eq(table.operationKind, "deadline")),
      orderBy: (table, { asc }) => [asc(table.sequence)],
    });
    expect(operationEvents).toMatchObject([
      {
        operationKind: "deadline",
        sequence: 1,
        source: "worker",
        phase: "deadline",
        status: "started",
        message: "Sandbox deadline evaluation started.",
        attributes: {
          deadlineDueAt: dueAt,
          deadlineGeneration: 1,
          deadlineKind: SandboxInstanceDeadlineKinds.IDLE,
          ownerLeaseId,
        },
      },
      {
        operationKind: "deadline",
        sequence: 2,
        source: "worker",
        phase: "deadline",
        status: "warning",
        message: "Sandbox deadline evaluation completed.",
        attributes: {
          deadlineDueAt: dueAt,
          deadlineGeneration: 1,
          deadlineKind: SandboxInstanceDeadlineKinds.IDLE,
          executed: false,
          outcome: "deadline_generation_mismatch",
          ownerLeaseId,
        },
      },
    ]);

    const persistedInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      columns: {
        status: true,
        stopReason: true,
      },
      where: (table, { eq }) => eq(table.id, sandboxInstanceId),
    });
    expect(persistedInstance).toEqual({
      status: SandboxInstanceStatuses.RUNNING,
      stopReason: null,
    });
  });

  it("does not execute a deadline when the persisted owner lease no longer matches", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_integration_new_deadline_owner_mismatch";
    await insertSandboxInstance(env, {
      sandboxInstanceId,
      status: SandboxInstanceStatuses.RUNNING,
      providerSandboxId: "provider-integration-new-deadline-owner-mismatch",
    });
    await insertDeadline(env, {
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      ownerLeaseId: "owner-integration-new-deadline-owner-current",
      dueAt: MatchingDeadlineDueAt,
    });

    const result = await runDeadlineWorkflow(env, {
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      ownerLeaseId: "owner-integration-new-deadline-owner-stale",
      dueAt: MatchingDeadlineDueAt,
      generation: 1,
    });

    expect(result).toEqual({
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      executed: false,
      outcome: "deadline_owner_lease_mismatch",
    });
    await expectSandboxStillRunning(env, sandboxInstanceId);
  });

  it("does not execute a deadline when the persisted due time no longer matches", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_integration_new_deadline_due_at_mismatch";
    await insertSandboxInstance(env, {
      sandboxInstanceId,
      status: SandboxInstanceStatuses.RUNNING,
      providerSandboxId: "provider-integration-new-deadline-due-at-mismatch",
    });
    await insertDeadline(env, {
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      ownerLeaseId: "owner-integration-new-deadline-due-at",
      dueAt: MatchingDeadlineDueAt,
    });

    const result = await runDeadlineWorkflow(env, {
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      ownerLeaseId: "owner-integration-new-deadline-due-at",
      dueAt: AlternateDeadlineDueAt,
      generation: 1,
    });

    expect(result).toEqual({
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      executed: false,
      outcome: "deadline_due_at_mismatch",
    });
    await expectSandboxStillRunning(env, sandboxInstanceId);
  });

  it("does not execute a deadline after the persisted row has already been cleared", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_integration_new_deadline_cleared";
    await insertSandboxInstance(env, {
      sandboxInstanceId,
      status: SandboxInstanceStatuses.RUNNING,
      providerSandboxId: "provider-integration-new-deadline-cleared",
    });
    await insertDeadline(env, {
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      ownerLeaseId: "owner-integration-new-deadline-cleared",
      dueAt: MatchingDeadlineDueAt,
      clearedAt: MatchingDeadlineDueAt,
    });

    const result = await runDeadlineWorkflow(env, {
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      ownerLeaseId: "owner-integration-new-deadline-cleared",
      dueAt: MatchingDeadlineDueAt,
      generation: 1,
    });

    expect(result).toEqual({
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      executed: false,
      outcome: "deadline_cleared",
    });
    await expectSandboxStillRunning(env, sandboxInstanceId);
  });

  it("clears both deadline kinds when the stop workflow marks a sandbox instance stopped", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_integration_new_deadline_stop_clears";
    await insertSandboxInstance(env, {
      sandboxInstanceId,
      status: SandboxInstanceStatuses.RUNNING,
      providerSandboxId: "provider-integration-new-deadline-stop-clears",
    });
    await insertBothDeadlineKinds(env, sandboxInstanceId);

    await applySandboxLifecycleEvent(
      {
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
      },
      {
        sandboxInstanceId,
        event: SandboxLifecycleEvents.STOP_REQUESTED,
      },
    );
    await expectSandboxStatus(env, sandboxInstanceId, SandboxInstanceStatuses.STOPPING);

    await markSandboxInstanceStoppedDuringStop({
      db: env.dataPlaneDb,
      tables: env.dataPlaneTables,
      sandboxInstanceId,
      stopReason: SandboxStopReasons.IDLE,
    });

    await expectDeadlinesCleared(env, sandboxInstanceId);
    await expectSandboxStatus(env, sandboxInstanceId, SandboxInstanceStatuses.STOPPED);
  });

  it("records the final mark-time fence decision when runtime state changes after the pre-mark check", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_integration_deadline_final_mark_fence";
    const ownerLeaseId = "owner-integration-deadline-final-mark-fence";
    await insertSandboxInstance(env, {
      sandboxInstanceId,
      status: SandboxInstanceStatuses.RUNNING,
      providerSandboxId: "provider-integration-deadline-final-mark-fence",
    });
    await insertDeadline(env, {
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      ownerLeaseId,
      dueAt: MatchingDeadlineDueAt,
    });

    const operationEvents = createWorkerSandboxLifecycleEventRecorder({
      clock: DeterministicIntegrationClock,
      db: env.dataPlaneDb,
      logger: dataPlaneWorkerLogger,
      operationId: "deadline-final-mark-fence-operation",
      operationKind: "deadline",
      sandboxInstanceId,
    });
    const result = await stopSandboxInstance(
      {
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
        sandboxRuntimeProviderResolver: ResumableStoppedRuntimeProviderResolver,
        runtimeStateReader: createChangingRuntimeStateReader({
          sandboxInstanceId,
          permittedOwnerLeaseId: ownerLeaseId,
          rejectedOwnerLeaseId: "owner-integration-deadline-final-mark-fence-new",
        }),
        clock: DeterministicIntegrationClock,
        operationEvents,
      },
      {
        sandboxInstanceId,
        stopReason: SandboxStopReasons.IDLE,
        expectedOwnerLeaseId: ownerLeaseId,
      },
    );

    expect(result).toEqual({
      executed: false,
      outcome: "runtime_state_fence_before_mark",
    });
    await expectSandboxStatus(env, sandboxInstanceId, SandboxInstanceStatuses.STOPPING);

    const persistedOperationEvents = await env.dataPlaneDb.query.sandboxOperationEvents.findMany({
      columns: {
        phase: true,
        status: true,
        message: true,
        attributes: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxInstanceId, sandboxInstanceId), eq(table.operationKind, "deadline")),
      orderBy: (table, { asc }) => [asc(table.sequence)],
    });

    expect(persistedOperationEvents).toMatchObject([
      {
        phase: "deadline",
        status: "completed",
        message: "Sandbox stop fence permitted at before_load.",
        attributes: {
          checkpoint: "before_load",
          permitted: true,
          snapshot: {
            ownerLeaseId,
          },
        },
      },
      {
        phase: "deadline",
        status: "completed",
        message: "Sandbox stop fence permitted at before_provider_stop.",
        attributes: {
          checkpoint: "before_provider_stop",
          permitted: true,
          snapshot: {
            ownerLeaseId,
          },
        },
      },
      {
        phase: "deadline",
        status: "completed",
        message: "Sandbox stop fence permitted at before_mark_stopped.",
        attributes: {
          checkpoint: "before_mark_stopped",
          permitted: true,
          snapshot: {
            ownerLeaseId,
          },
        },
      },
      {
        phase: "deadline",
        status: "warning",
        message: "Sandbox stop fence rejected at final_mark_stopped.",
        attributes: {
          checkpoint: "final_mark_stopped",
          expectedOwnerLeaseId: ownerLeaseId,
          permitted: false,
          snapshot: {
            ownerLeaseId: "owner-integration-deadline-final-mark-fence-new",
          },
        },
      },
    ]);
  });

  it("clears both deadline kinds when start failure marks a sandbox instance failed", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_integration_new_deadline_start_failure_clears";
    await insertSandboxInstance(env, {
      sandboxInstanceId,
      status: SandboxInstanceStatuses.STARTING,
      providerSandboxId: "provider-integration-new-deadline-start-failure-clears",
    });
    await insertBothDeadlineKinds(env, sandboxInstanceId);

    await markSandboxInstanceFailedDuringStart(
      {
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
      },
      {
        sandboxInstanceId,
        failureCode: "sandbox_init_failed",
        failureMessage: "sandbox initialization failed during integration-new test",
      },
    );

    await expectDeadlinesCleared(env, sandboxInstanceId);
  });

  it("clears both deadline kinds when reconcile marks a sandbox instance stopped", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_integration_new_deadline_reconcile_stop_clears";
    await insertSandboxInstance(env, {
      sandboxInstanceId,
      status: SandboxInstanceStatuses.RUNNING,
      providerSandboxId: "provider-integration-new-deadline-reconcile-stop-clears",
    });
    await insertBothDeadlineKinds(env, sandboxInstanceId);

    await markSandboxInstanceStoppedDuringReconcile({
      db: env.dataPlaneDb,
      tables: env.dataPlaneTables,
      sandboxInstanceId,
      currentStatus: "running",
    });

    await expectDeadlinesCleared(env, sandboxInstanceId);
  });

  it("can stop and finalize a starting sandbox during disconnect reconciliation", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_integration_new_deadline_reconcile_starting_stop";
    await insertSandboxInstance(env, {
      sandboxInstanceId,
      status: SandboxInstanceStatuses.STARTING,
      providerSandboxId: "provider-integration-new-deadline-reconcile-starting-stop",
    });
    await insertBothDeadlineKinds(env, sandboxInstanceId);

    await applySandboxLifecycleEvent(
      {
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
      },
      {
        sandboxInstanceId,
        event: SandboxLifecycleEvents.STOP_REQUESTED,
      },
    );
    await expectSandboxStatus(env, sandboxInstanceId, SandboxInstanceStatuses.STOPPING);

    await markSandboxInstanceStoppedDuringReconcile({
      db: env.dataPlaneDb,
      tables: env.dataPlaneTables,
      sandboxInstanceId,
      currentStatus: SandboxInstanceStatuses.STOPPING,
    });

    await expectDeadlinesCleared(env, sandboxInstanceId);
    await expectSandboxStatus(env, sandboxInstanceId, SandboxInstanceStatuses.STOPPED);
  });

  it("clears both deadline kinds when reconcile marks a sandbox instance failed", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_integration_new_deadline_reconcile_failure_clears";
    await insertSandboxInstance(env, {
      sandboxInstanceId,
      status: SandboxInstanceStatuses.RUNNING,
      providerSandboxId: "provider-integration-new-deadline-reconcile-failure-clears",
    });
    await insertBothDeadlineKinds(env, sandboxInstanceId);

    await markSandboxInstanceFailedDuringReconcile({
      db: env.dataPlaneDb,
      tables: env.dataPlaneTables,
      sandboxInstanceId,
      currentStatus: "running",
      failureCode: "provider_runtime_missing",
      failureMessage: "provider runtime missing during integration-new test",
    });

    await expectDeadlinesCleared(env, sandboxInstanceId);
  });

  it("clears both deadline kinds when reconcile finalizes a stopping sandbox instance", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_integration_new_deadline_reconcile_stopping_clears";
    await insertSandboxInstance(env, {
      sandboxInstanceId,
      status: SandboxInstanceStatuses.STOPPING,
      providerSandboxId: "provider-integration-new-deadline-reconcile-stopping-clears",
    });
    await insertBothDeadlineKinds(env, sandboxInstanceId);

    await markSandboxInstanceStoppedDuringReconcile({
      db: env.dataPlaneDb,
      tables: env.dataPlaneTables,
      sandboxInstanceId,
      currentStatus: SandboxInstanceStatuses.STOPPING,
    });

    await expectDeadlinesCleared(env, sandboxInstanceId);
    await expectSandboxStatus(env, sandboxInstanceId, SandboxInstanceStatuses.STOPPED);
  });

  it("leaves snapshot lifecycle-owned sandboxes running when idle and disconnect deadlines fire", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_integration_snapshot_deadline_owned";
    await insertSandboxInstance(env, {
      sandboxInstanceId,
      status: SandboxInstanceStatuses.RUNNING,
      providerSandboxId: "provider-integration-snapshot-deadline-owned",
      purpose: SandboxInstancePurposes.SNAPSHOT,
    });
    await insertBothDeadlineKinds(env, sandboxInstanceId);

    await expect(
      runDeadlineWorkflow(env, {
        sandboxInstanceId,
        kind: SandboxInstanceDeadlineKinds.IDLE,
        ownerLeaseId: `owner_idle_${sandboxInstanceId}`,
        dueAt: MatchingDeadlineDueAt,
        generation: 1,
      }),
    ).resolves.toEqual({
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      executed: false,
      outcome: "snapshot_skipped",
    });

    await expect(
      runDeadlineWorkflow(env, {
        sandboxInstanceId,
        kind: SandboxInstanceDeadlineKinds.DISCONNECT,
        ownerLeaseId: `owner_disconnect_${sandboxInstanceId}`,
        dueAt: MatchingDeadlineDueAt,
        generation: 1,
      }),
    ).resolves.toEqual({
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.DISCONNECT,
      executed: false,
      outcome: "snapshot_skipped",
    });

    await expectSandboxStillRunning(env, sandboxInstanceId);
  });
});

async function insertSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    sandboxInstanceId: string;
    status:
      | typeof SandboxInstanceStatuses.RUNNING
      | typeof SandboxInstanceStatuses.STARTING
      | typeof SandboxInstanceStatuses.STOPPING;
    providerSandboxId: string;
    purpose?: typeof SandboxInstancePurposes.SESSION | typeof SandboxInstancePurposes.SNAPSHOT;
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: `org_${input.sandboxInstanceId}`,
    sandboxProfileId: `sbp_${input.sandboxInstanceId}`,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: input.providerSandboxId,
    status: input.status,
    purpose: input.purpose ?? SandboxInstancePurposes.SESSION,
    startedByKind: "system",
    startedById: `worker_${input.sandboxInstanceId}`,
    source: SandboxInstanceSources.DASHBOARD,
  });
}

async function insertBothDeadlineKinds(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceDeadlines).values([
    {
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      ownerLeaseId: `owner_idle_${sandboxInstanceId}`,
      dueAt: MatchingDeadlineDueAt,
    },
    {
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.DISCONNECT,
      ownerLeaseId: `owner_disconnect_${sandboxInstanceId}`,
      dueAt: MatchingDeadlineDueAt,
    },
  ]);
}

async function insertDeadline(
  env: IntegrationTestEnvironment,
  input: {
    sandboxInstanceId: string;
    kind: typeof SandboxInstanceDeadlineKinds.IDLE | typeof SandboxInstanceDeadlineKinds.DISCONNECT;
    ownerLeaseId: string;
    dueAt: string;
    generation?: number;
    clearedAt?: string | null;
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceDeadlines).values({
    sandboxInstanceId: input.sandboxInstanceId,
    kind: input.kind,
    ownerLeaseId: input.ownerLeaseId,
    dueAt: input.dueAt,
    generation: input.generation ?? 1,
    clearedAt: input.clearedAt ?? null,
  });
}

async function runDeadlineWorkflow(env: IntegrationTestEnvironment, input: DeadlineWorkflowInput) {
  const handle = await env.dataPlaneWorkflow.runWorkflow(
    HandleSandboxInstanceDeadlineWorkflowSpec,
    input,
  );

  return await handle.result({
    timeoutMs: 15_000,
  });
}

async function expectSandboxStillRunning(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
): Promise<void> {
  const persistedInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
    columns: {
      status: true,
      stopReason: true,
    },
    where: (table, { eq }) => eq(table.id, sandboxInstanceId),
  });

  expect(persistedInstance).toEqual({
    status: SandboxInstanceStatuses.RUNNING,
    stopReason: null,
  });
}

async function expectSandboxStatus(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
  status: string,
): Promise<void> {
  const persistedInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
    columns: {
      status: true,
    },
    where: (table, { eq }) => eq(table.id, sandboxInstanceId),
  });

  expect(persistedInstance).toEqual({
    status,
  });
}

async function expectDeadlinesCleared(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
): Promise<void> {
  const deadlineRows = await env.dataPlaneDb.query.sandboxInstanceDeadlines.findMany({
    columns: {
      kind: true,
      clearedAt: true,
    },
    where: (table, { eq }) => eq(table.sandboxInstanceId, sandboxInstanceId),
    orderBy: (table, { asc }) => asc(table.kind),
  });

  expect(deadlineRows).toEqual([
    {
      kind: SandboxInstanceDeadlineKinds.DISCONNECT,
      clearedAt: expect.any(String),
    },
    {
      kind: SandboxInstanceDeadlineKinds.IDLE,
      clearedAt: expect.any(String),
    },
  ]);
}

const DeterministicIntegrationClock: Clock = {
  nowMs: () => Date.parse("2026-05-16T00:00:00.000Z"),
  nowDate: () => new Date("2026-05-16T00:00:00.000Z"),
};

const ResumableStoppedSandboxAdapter: SandboxAdapter = {
  getTransparentProxyConfiguration: () =>
    createTransparentProxyConfiguration({
      provider: SandboxProvider.DOCKER,
      exclusions: [],
      smokeRequirements: [],
    }),
  prepareImage: async (request) => request.image,
  start: async () => {
    throw new Error("This test does not start provider sandboxes.");
  },
  inspect: async (request) => ({
    provider: SandboxProvider.DOCKER,
    id: request.id,
    state: SandboxInspectStates.STOPPED,
    disposition: SandboxInspectDispositions.RESUMABLE_STOPPED,
    createdAt: "2026-05-16T00:00:00.000Z",
    startedAt: "2026-05-16T00:00:00.000Z",
    endedAt: "2026-05-16T00:00:00.000Z",
    raw: {},
  }),
  resume: async () => {
    throw new Error("This test does not resume provider sandboxes.");
  },
  captureSnapshot: async () => {
    throw new Error("This test does not capture provider snapshots.");
  },
  stop: async () => {
    throw new Error("This test does not stop provider sandboxes.");
  },
  destroy: async () => {
    throw new Error("This test does not destroy provider sandboxes.");
  },
};

const UnusedSandboxRuntimeControl: SandboxRuntimeControl = {
  readSandboxdVersion: async () => {
    throw new Error("This test does not read sandboxd versions.");
  },
  ensureSandboxd: async () => {
    throw new Error("This test does not ensure sandboxd.");
  },
  activate: async () => {
    throw new Error("This test does not activate sandboxes.");
  },
  shutdown: async () => {
    throw new Error("This test does not shut down sandboxes.");
  },
  readOperationLog: async () => {
    throw new Error("This test does not read operation logs.");
  },
  close: async () => {},
};

const ResumableStoppedRuntimeProviderResolver = {
  resolve: async () => ({
    provider: SandboxProvider.DOCKER,
    sandboxAdapter: ResumableStoppedSandboxAdapter,
    sandboxRuntimeControl: UnusedSandboxRuntimeControl,
  }),
  resolveForImagePreparation: async () => {
    throw new Error("This test does not prepare images.");
  },
};

function createChangingRuntimeStateReader(input: {
  sandboxInstanceId: string;
  permittedOwnerLeaseId: string;
  rejectedOwnerLeaseId: string;
}): SandboxRuntimeStateReader {
  let readCount = 0;
  return {
    readSnapshot: async () => {
      readCount += 1;
      return createRuntimeStateSnapshot({
        sandboxInstanceId: input.sandboxInstanceId,
        ownerLeaseId: readCount < 4 ? input.permittedOwnerLeaseId : input.rejectedOwnerLeaseId,
      });
    },
  };
}

function createRuntimeStateSnapshot(input: {
  sandboxInstanceId: string;
  ownerLeaseId: string;
}): SandboxRuntimeStateSnapshot {
  return {
    ownerLeaseId: input.ownerLeaseId,
    attachment: {
      sandboxInstanceId: input.sandboxInstanceId,
      ownerLeaseId: input.ownerLeaseId,
      nodeId: `node_${input.sandboxInstanceId}`,
      sessionId: `session_${input.sandboxInstanceId}`,
      attachedAtMs: DeterministicIntegrationClock.nowMs(),
    },
    presence: {
      activeCount: 0,
    },
    keepalive: {
      active: false,
    },
    runtime: {
      ready: true,
    },
  };
}
