/* eslint-disable jest/no-standalone-expect --
 * The test cases use an extended Vitest fixture created by the test harness.
 */

import {
  SandboxInstanceDeadlineKinds,
  SandboxInstancePersistenceModes,
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxInstanceStatuses,
  SandboxStopReasons,
} from "@mistle/db/data-plane";
import { SandboxLifecycleEvents } from "@mistle/sandbox-lifecycle";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { HandleSandboxInstanceDeadlineWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { describe, expect } from "vitest";

import { markSandboxInstanceFailed as markSandboxInstanceFailedDuringReconcile } from "../openworkflow/reconcile-sandbox-instance/mark-sandbox-instance-failed.js";
import { markSandboxInstanceStopped as markSandboxInstanceStoppedDuringReconcile } from "../openworkflow/reconcile-sandbox-instance/mark-sandbox-instance-stopped.js";
import { applySandboxLifecycleEvent } from "../openworkflow/shared/apply-sandbox-lifecycle-event.js";
import { markSandboxInstanceFailed as markSandboxInstanceFailedDuringStart } from "../openworkflow/start-sandbox-instance/mark-sandbox-instance-failed.js";
import { markSandboxInstanceStopped as markSandboxInstanceStoppedDuringStop } from "../openworkflow/stop-sandbox-instance/mark-sandbox-instance-stopped.js";

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
      persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
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
    persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
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
