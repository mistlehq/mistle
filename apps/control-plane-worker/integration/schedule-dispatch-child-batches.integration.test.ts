/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  TriggerKinds,
  TriggerRunStatuses,
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionSnapshotJobTriggers,
  ScheduledActionStatuses,
  ScheduleTargetTypes,
} from "@mistle/db/control-plane";
import {
  createControlPlaneWorkflowNamespaceId,
  createDataPlaneWorkflowNamespaceId,
} from "@mistle/db/test-environment";
import {
  createIntegrationTest,
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import {
  HandleTriggerRunWorkflowSpec,
  ScheduleDispatchBatchWorkflowSpec,
} from "@mistle/workflow-registry/control-plane";
import { MaterializeSandboxProfileVersionSnapshotWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { eq, sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import { z } from "zod";

import { createScheduleDispatchBatchIdempotencyKey } from "../openworkflow/schedule-dispatch/batches.js";
import { claimScheduledActionForDispatch } from "../openworkflow/schedule-dispatch/claim-scheduled-action.js";
import { dispatchScheduledAction } from "../openworkflow/schedule-dispatch/dispatch-scheduled-action.js";
import { startScheduleDispatchChildBatches } from "../openworkflow/schedule-dispatch/start-child-batches.js";

const it = createIntegrationTest({
  services: ["control-plane-worker", "data-plane-api"],
});

describe.concurrent("control-plane worker schedule dispatch child batches", () => {
  it("atomically claims a pending scheduled action for dispatch", async ({ env }) => {
    await seedTriggerSchedule({
      env,
      organizationId: "org_integration_new_schedule_batch_claim_pending",
      triggerId: "atm_integration_new_schedule_batch_claim_pending",
      scheduleId: "sch_integration_new_schedule_batch_claim_pending",
    });
    await seedScheduledAction({
      env,
      id: "sca_integration_new_schedule_batch_claim_pending",
      organizationId: "org_integration_new_schedule_batch_claim_pending",
      scheduleId: "sch_integration_new_schedule_batch_claim_pending",
    });

    const claim = await claimScheduledActionForDispatch(
      { db: env.controlPlaneDb },
      {
        scheduledActionId: "sca_integration_new_schedule_batch_claim_pending",
        dispatchClaimKey: "schedule-dispatch-batch:integration-new-claim",
        staleDispatchingBefore: new Date("2026-04-28T01:10:00.000Z"),
      },
    );

    expect(claim).toEqual(
      expect.objectContaining({
        status: "claimed",
        scheduledActionId: "sca_integration_new_schedule_batch_claim_pending",
        previousStatus: ScheduledActionStatuses.PENDING,
        previousDispatchClaimKey: null,
        previousDispatchingAt: null,
      }),
    );

    const persistedAction = await env.controlPlaneDb.query.scheduledActions.findFirst({
      where: (table, { eq }) => eq(table.id, "sca_integration_new_schedule_batch_claim_pending"),
    });
    expect(persistedAction).toEqual(
      expect.objectContaining({
        status: ScheduledActionStatuses.DISPATCHING,
        dispatchClaimKey: "schedule-dispatch-batch:integration-new-claim",
      }),
    );
    expect(persistedAction?.dispatchingAt).not.toBeNull();
  });

  it("does not steal a non-stale dispatching action claimed by another child", async ({ env }) => {
    await seedTriggerSchedule({
      env,
      organizationId: "org_integration_new_schedule_batch_claim_fresh",
      triggerId: "atm_integration_new_schedule_batch_claim_fresh",
      scheduleId: "sch_integration_new_schedule_batch_claim_fresh",
    });
    await seedScheduledAction({
      env,
      id: "sca_integration_new_schedule_batch_claim_fresh",
      organizationId: "org_integration_new_schedule_batch_claim_fresh",
      scheduleId: "sch_integration_new_schedule_batch_claim_fresh",
      status: ScheduledActionStatuses.DISPATCHING,
      dispatchClaimKey: "schedule-dispatch-batch:other-child",
      dispatchingAt: "2026-04-28T01:09:30.000Z",
    });

    const claim = await claimScheduledActionForDispatch(
      { db: env.controlPlaneDb },
      {
        scheduledActionId: "sca_integration_new_schedule_batch_claim_fresh",
        dispatchClaimKey: "schedule-dispatch-batch:integration-new-fresh",
        staleDispatchingBefore: new Date("2026-04-28T01:09:00.000Z"),
      },
    );

    expect(claim).toEqual({
      status: "actively-dispatching",
      scheduledActionId: "sca_integration_new_schedule_batch_claim_fresh",
    });

    const persistedAction = await env.controlPlaneDb.query.scheduledActions.findFirst({
      where: (table, { eq }) => eq(table.id, "sca_integration_new_schedule_batch_claim_fresh"),
    });
    expect(persistedAction).toEqual(
      expect.objectContaining({
        status: ScheduledActionStatuses.DISPATCHING,
        dispatchClaimKey: "schedule-dispatch-batch:other-child",
        dispatchingAt: "2026-04-28 01:09:30+00",
      }),
    );
  });

  it("reclaims stale dispatching actions and reports previous claim metadata", async ({ env }) => {
    await seedTriggerSchedule({
      env,
      organizationId: "org_integration_new_schedule_batch_claim_stale",
      triggerId: "atm_integration_new_schedule_batch_claim_stale",
      scheduleId: "sch_integration_new_schedule_batch_claim_stale",
    });
    await seedScheduledAction({
      env,
      id: "sca_integration_new_schedule_batch_claim_stale",
      organizationId: "org_integration_new_schedule_batch_claim_stale",
      scheduleId: "sch_integration_new_schedule_batch_claim_stale",
      status: ScheduledActionStatuses.DISPATCHING,
      dispatchClaimKey: "schedule-dispatch-batch:stale-child",
      dispatchingAt: "2026-04-28T01:00:00.000Z",
    });

    const claim = await claimScheduledActionForDispatch(
      { db: env.controlPlaneDb },
      {
        scheduledActionId: "sca_integration_new_schedule_batch_claim_stale",
        dispatchClaimKey: "schedule-dispatch-batch:integration-new-stale",
        staleDispatchingBefore: new Date("2026-04-28T01:05:00.000Z"),
      },
    );

    expect(claim).toEqual(
      expect.objectContaining({
        status: "claimed",
        scheduledActionId: "sca_integration_new_schedule_batch_claim_stale",
        previousStatus: ScheduledActionStatuses.DISPATCHING,
        previousDispatchClaimKey: "schedule-dispatch-batch:stale-child",
        previousDispatchingAt: "2026-04-28 01:00:00+00",
      }),
    );

    const persistedAction = await env.controlPlaneDb.query.scheduledActions.findFirst({
      where: (table, { eq }) => eq(table.id, "sca_integration_new_schedule_batch_claim_stale"),
    });
    expect(persistedAction).toEqual(
      expect.objectContaining({
        status: ScheduledActionStatuses.DISPATCHING,
        dispatchClaimKey: "schedule-dispatch-batch:integration-new-stale",
      }),
    );
  });

  it("starts one child workflow for pending and stale dispatching scheduled actions", async ({
    env,
  }) => {
    await seedTriggerSchedule({
      env,
      organizationId: "org_integration_new_schedule_batch_start",
      triggerId: "atm_integration_new_schedule_batch_start",
      scheduleId: "sch_integration_new_schedule_batch_start",
    });
    await seedScheduledAction({
      env,
      id: "sca_integration_new_schedule_batch_pending_recovered",
      organizationId: "org_integration_new_schedule_batch_start",
      scheduleId: "sch_integration_new_schedule_batch_start",
      scheduledAt: "2026-04-28T00:05:00.000Z",
      localScheduledTime: "08:05",
    });
    await seedScheduledAction({
      env,
      id: "sca_integration_new_schedule_batch_stale_recovered",
      organizationId: "org_integration_new_schedule_batch_start",
      scheduleId: "sch_integration_new_schedule_batch_start",
      status: ScheduledActionStatuses.DISPATCHING,
      dispatchClaimKey: "schedule-dispatch-batch:stale",
      dispatchingAt: "2026-04-27T23:40:00.000Z",
      scheduledAt: "2026-04-28T00:04:00.000Z",
      localScheduledTime: "08:04",
    });
    await seedScheduledAction({
      env,
      id: "sca_integration_new_schedule_batch_active_ignored",
      organizationId: "org_integration_new_schedule_batch_start",
      scheduleId: "sch_integration_new_schedule_batch_start",
      status: ScheduledActionStatuses.DISPATCHING,
      dispatchClaimKey: "schedule-dispatch-batch:active",
      dispatchingAt: "2026-04-28T00:04:00.000Z",
      scheduledAt: "2026-04-28T00:03:00.000Z",
      localScheduledTime: "08:03",
    });
    await seedScheduledAction({
      env,
      id: "sca_integration_new_schedule_batch_future_ignored",
      organizationId: "org_integration_new_schedule_batch_start",
      scheduleId: "sch_integration_new_schedule_batch_start",
      scheduledAt: "2026-04-28T00:11:00.000Z",
      localScheduledTime: "08:11",
    });

    const result = await startScheduleDispatchChildBatches(
      {
        db: env.controlPlaneDb,
        openWorkflow: env.controlPlaneWorkflow,
      },
      {
        cutoffMinute: new Date("2026-04-28T00:05:00.000Z"),
        scheduledActionIds: ["sca_integration_new_schedule_batch_input"],
      },
    );

    const expectedScheduledActionIds = [
      "sca_integration_new_schedule_batch_input",
      "sca_integration_new_schedule_batch_pending_recovered",
      "sca_integration_new_schedule_batch_stale_recovered",
    ];
    expect(result).toEqual({
      scheduledActionIds: expectedScheduledActionIds,
      childBatchCount: 1,
      pendingRecoveredCount: 1,
      staleDispatchingRecoveredCount: 1,
    });

    const childRun = await readControlPlaneWorkflowRunByIdempotencyKey(env, {
      workflowName: ScheduleDispatchBatchWorkflowSpec.name,
      idempotencyKey: createScheduleDispatchBatchIdempotencyKey(expectedScheduledActionIds),
    });

    expect(childRun).toEqual(
      expect.objectContaining({
        workflow_name: ScheduleDispatchBatchWorkflowSpec.name,
        input: {
          scheduledActionIds: expectedScheduledActionIds,
        },
      }),
    );
    expect(["pending", "running", "completed"]).toContain(childRun?.status);
  });

  it("uses OpenWorkflow idempotency for schedule dispatch child batches", async ({ env }) => {
    const workflowInput = {
      scheduledActionIds: ["sca_integration_new_schedule_batch_openworkflow_idempotent"],
    };
    const idempotencyKey = createScheduleDispatchBatchIdempotencyKey(
      workflowInput.scheduledActionIds,
    );

    const firstRun = await env.controlPlaneWorkflow.runWorkflow(
      ScheduleDispatchBatchWorkflowSpec,
      workflowInput,
      {
        idempotencyKey,
      },
    );
    const secondRun = await env.controlPlaneWorkflow.runWorkflow(
      ScheduleDispatchBatchWorkflowSpec,
      workflowInput,
      {
        idempotencyKey,
      },
    );

    expect(secondRun.workflowRun.id).toBe(firstRun.workflowRun.id);
  });

  it("creates one trigger run and starts the trigger run workflow for scheduled trigger actions", async ({
    env,
  }) => {
    await seedTriggerSchedule({
      env,
      organizationId: "org_integration_new_schedule_batch_trigger_run",
      triggerId: "atm_integration_new_schedule_batch_trigger_run",
      scheduleId: "sch_integration_new_schedule_batch_trigger_run",
      includeTriggerTarget: true,
    });
    await seedScheduledAction({
      env,
      id: "sca_integration_new_schedule_batch_trigger_run",
      organizationId: "org_integration_new_schedule_batch_trigger_run",
      scheduleId: "sch_integration_new_schedule_batch_trigger_run",
      targetPayloadTriggerId: "atm_integration_new_schedule_batch_trigger_run",
    });

    const result = await dispatchScheduledAction(createDispatchContext(env), {
      scheduledActionId: "sca_integration_new_schedule_batch_trigger_run",
      dispatchClaimKey: "schedule-dispatch-batch:integration-new-trigger-run",
      staleDispatchingBefore: new Date("2026-04-28T01:00:00.000Z"),
    });

    expect(result).toEqual({
      scheduledActionId: "sca_integration_new_schedule_batch_trigger_run",
      status: "dispatched",
    });

    const triggerRunsForAction = await env.controlPlaneDb.query.triggerRuns.findMany({
      where: (table, { eq }) =>
        eq(table.sourceScheduledActionId, "sca_integration_new_schedule_batch_trigger_run"),
    });
    expect(triggerRunsForAction).toHaveLength(1);
    expect(triggerRunsForAction[0]).toEqual(
      expect.objectContaining({
        triggerId: "atm_integration_new_schedule_batch_trigger_run",
        triggerTargetId: "atg_atm_integration_new_schedule_batch_trigger_run",
        status: TriggerRunStatuses.QUEUED,
        sourceScheduledActionId: "sca_integration_new_schedule_batch_trigger_run",
      }),
    );

    const triggerRun = triggerRunsForAction[0];
    if (triggerRun === undefined) {
      throw new Error("Expected scheduled trigger run to be created.");
    }
    const triggerWorkflowRun = await readControlPlaneWorkflowRunByIdempotencyKey(env, {
      workflowName: HandleTriggerRunWorkflowSpec.name,
      idempotencyKey: triggerRun.id,
    });
    expect(triggerWorkflowRun).toEqual(
      expect.objectContaining({
        workflow_name: HandleTriggerRunWorkflowSpec.name,
        input: {
          triggerRunId: triggerRun.id,
        },
      }),
    );
    expect(["pending", "running", "completed"]).toContain(triggerWorkflowRun?.status);

    const persistedAction = await env.controlPlaneDb.query.scheduledActions.findFirst({
      where: (table, { eq }) => eq(table.id, "sca_integration_new_schedule_batch_trigger_run"),
    });
    expect(persistedAction).toEqual(
      expect.objectContaining({
        status: ScheduledActionStatuses.DISPATCHED,
        dispatchClaimKey: "schedule-dispatch-batch:integration-new-trigger-run",
        targetWorkflowId: triggerWorkflowRun?.id,
      }),
    );
    expect(persistedAction?.dispatchedAt).not.toBeNull();
  });

  it("reuses the trigger run and workflow when retrying the same scheduled trigger action", async ({
    env,
  }) => {
    await seedTriggerSchedule({
      env,
      organizationId: "org_integration_new_schedule_batch_trigger_retry",
      triggerId: "atm_integration_new_schedule_batch_trigger_retry",
      scheduleId: "sch_integration_new_schedule_batch_trigger_retry",
      includeTriggerTarget: true,
    });
    await seedScheduledAction({
      env,
      id: "sca_integration_new_schedule_batch_trigger_retry",
      organizationId: "org_integration_new_schedule_batch_trigger_retry",
      scheduleId: "sch_integration_new_schedule_batch_trigger_retry",
      targetPayloadTriggerId: "atm_integration_new_schedule_batch_trigger_retry",
    });

    await dispatchScheduledAction(createDispatchContext(env), {
      scheduledActionId: "sca_integration_new_schedule_batch_trigger_retry",
      dispatchClaimKey: "schedule-dispatch-batch:integration-new-trigger-retry",
      staleDispatchingBefore: new Date("2026-04-28T01:00:00.000Z"),
    });
    const [firstTriggerRun] = await env.controlPlaneDb.query.triggerRuns.findMany({
      where: (table, { eq }) =>
        eq(table.sourceScheduledActionId, "sca_integration_new_schedule_batch_trigger_retry"),
    });
    if (firstTriggerRun === undefined) {
      throw new Error("Expected first scheduled trigger run to be created.");
    }
    const firstWorkflowRun = await readControlPlaneWorkflowRunByIdempotencyKey(env, {
      workflowName: HandleTriggerRunWorkflowSpec.name,
      idempotencyKey: firstTriggerRun.id,
    });

    await env.controlPlaneDb
      .update(env.controlPlaneTables.scheduledActions)
      .set({
        status: ScheduledActionStatuses.DISPATCHING,
        dispatchedAt: null,
        targetWorkflowId: null,
        targetWorkflowStartedAt: null,
      })
      .where(
        eq(
          env.controlPlaneTables.scheduledActions.id,
          "sca_integration_new_schedule_batch_trigger_retry",
        ),
      );

    await dispatchScheduledAction(createDispatchContext(env), {
      scheduledActionId: "sca_integration_new_schedule_batch_trigger_retry",
      dispatchClaimKey: "schedule-dispatch-batch:integration-new-trigger-retry",
      staleDispatchingBefore: new Date("2026-04-28T01:00:00.000Z"),
    });

    const triggerRunsForAction = await env.controlPlaneDb.query.triggerRuns.findMany({
      where: (table, { eq }) =>
        eq(table.sourceScheduledActionId, "sca_integration_new_schedule_batch_trigger_retry"),
    });
    expect(triggerRunsForAction).toHaveLength(1);

    const persistedAction = await env.controlPlaneDb.query.scheduledActions.findFirst({
      where: (table, { eq }) => eq(table.id, "sca_integration_new_schedule_batch_trigger_retry"),
    });
    expect(persistedAction).toEqual(
      expect.objectContaining({
        status: ScheduledActionStatuses.DISPATCHED,
        targetWorkflowId: firstWorkflowRun?.id,
      }),
    );
  });

  it("marks deterministic scheduled trigger handoff failures as terminal", async ({ env }) => {
    const cases = [
      {
        id: "missing_target",
        seed: {
          includeScheduleTrigger: false,
        },
        expectedFailureCode: "schedule_trigger_not_found",
      },
      {
        id: "disabled_trigger",
        seed: {
          triggerEnabled: false,
          includeTriggerTarget: true,
        },
        expectedFailureCode: "trigger_disabled",
      },
      {
        id: "disabled_schedule",
        seed: {
          includeTriggerTarget: true,
          scheduleEnabled: false,
        },
        expectedFailureCode: "schedule_disabled",
      },
      {
        id: "deleted_schedule",
        seed: {
          includeTriggerTarget: true,
          scheduleDeletedAt: "2026-04-28T00:00:00.000Z",
        },
        expectedFailureCode: "schedule_deleted",
      },
      {
        id: "missing_trigger_target",
        seed: {},
        expectedFailureCode: "trigger_target_not_found",
      },
    ];

    for (const testCase of cases) {
      const organizationId = `org_integration_new_schedule_batch_${testCase.id}`;
      const triggerId = `atm_integration_new_schedule_batch_${testCase.id}`;
      const scheduleId = `sch_integration_new_schedule_batch_${testCase.id}`;
      const scheduledActionId = `sca_integration_new_schedule_batch_${testCase.id}`;
      await seedTriggerSchedule({
        env,
        organizationId,
        triggerId,
        scheduleId,
        ...testCase.seed,
      });
      await seedScheduledAction({
        env,
        id: scheduledActionId,
        organizationId,
        scheduleId,
        targetPayloadTriggerId: triggerId,
      });

      const result = await dispatchScheduledAction(createDispatchContext(env), {
        scheduledActionId,
        dispatchClaimKey: `schedule-dispatch-batch:integration-new-${testCase.id}`,
        staleDispatchingBefore: new Date("2026-04-28T01:00:00.000Z"),
      });

      expect(result).toEqual({
        scheduledActionId,
        status: "failed",
      });

      const persistedAction = await env.controlPlaneDb.query.scheduledActions.findFirst({
        where: (table, { eq }) => eq(table.id, scheduledActionId),
      });
      expect(persistedAction).toEqual(
        expect.objectContaining({
          status: ScheduledActionStatuses.FAILED,
          failureCode: testCase.expectedFailureCode,
        }),
      );
      expect(persistedAction?.failedAt).not.toBeNull();
    }
  });

  it("hands scheduled snapshot refreshes off to the real data-plane API", async ({ env }) => {
    await seedSnapshotRefreshScheduledAction({
      env,
      organizationId: "org_integration_new_schedule_batch_snapshot_create",
      profileId: "sbp_integration_new_schedule_batch_snapshot_create",
      profileVersion: 1,
      scheduleId: "sch_integration_new_schedule_batch_snapshot_create",
      scheduledActionId: "sca_integration_new_schedule_batch_snapshot_create",
    });

    const result = await dispatchScheduledAction(createDispatchContext(env), {
      scheduledActionId: "sca_integration_new_schedule_batch_snapshot_create",
      dispatchClaimKey: "schedule-dispatch-batch:integration-new-snapshot",
      staleDispatchingBefore: new Date("2026-04-28T01:00:00.000Z"),
    });

    expect(result).toEqual({
      scheduledActionId: "sca_integration_new_schedule_batch_snapshot_create",
      status: "dispatched",
    });

    const snapshotJobs = await env.controlPlaneDb.query.sandboxProfileVersionSnapshotJobs.findMany({
      where: (table, { eq }) =>
        eq(table.sourceScheduledActionId, "sca_integration_new_schedule_batch_snapshot_create"),
    });
    expect(snapshotJobs).toHaveLength(1);
    expect(snapshotJobs[0]).toEqual(
      expect.objectContaining({
        sandboxProfileId: "sbp_integration_new_schedule_batch_snapshot_create",
        sandboxProfileVersion: 1,
        sandboxInstanceId: expect.any(String),
        trigger: SandboxProfileVersionSnapshotJobTriggers.SCHEDULED_REFRESH,
        state: SandboxProfileVersionSnapshotJobStates.QUEUED,
        sourceScheduledActionId: "sca_integration_new_schedule_batch_snapshot_create",
        workflowRunId: null,
      }),
    );

    const persistedAction = await env.controlPlaneDb.query.scheduledActions.findFirst({
      where: (table, { eq }) => eq(table.id, "sca_integration_new_schedule_batch_snapshot_create"),
    });
    expect(persistedAction).toEqual(
      expect.objectContaining({
        status: ScheduledActionStatuses.DISPATCHED,
        targetWorkflowId: expect.any(String),
      }),
    );
    expect(persistedAction?.dispatchedAt).not.toBeNull();
  });

  it("uses setup refresh when scheduled maintenance fires before the first snapshot exists", async ({
    env,
  }) => {
    await seedSnapshotRefreshScheduledAction({
      env,
      organizationId: "org_integration_new_schedule_batch_snapshot_initial_setup",
      profileId: "sbp_integration_new_schedule_batch_snapshot_initial_setup",
      profileVersion: 1,
      scheduleId: "sch_integration_new_schedule_batch_snapshot_initial_setup",
      scheduledActionId: "sca_integration_new_schedule_batch_snapshot_initial_setup",
      maintenanceScript: "echo maintain",
      snapshotImageId: null,
    });

    const result = await dispatchScheduledAction(createDispatchContext(env), {
      scheduledActionId: "sca_integration_new_schedule_batch_snapshot_initial_setup",
      dispatchClaimKey: "schedule-dispatch-batch:integration-new-snapshot-initial-setup",
      staleDispatchingBefore: new Date("2026-04-28T01:00:00.000Z"),
    });

    expect(result).toEqual({
      scheduledActionId: "sca_integration_new_schedule_batch_snapshot_initial_setup",
      status: "dispatched",
    });

    const [snapshotJob] = await env.controlPlaneDb.query.sandboxProfileVersionSnapshotJobs.findMany(
      {
        where: (table, { eq }) =>
          eq(
            table.sourceScheduledActionId,
            "sca_integration_new_schedule_batch_snapshot_initial_setup",
          ),
      },
    );
    if (snapshotJob === undefined) {
      throw new Error("Expected scheduled snapshot refresh job to be created.");
    }

    const snapshotWorkflowRun = await readDataPlaneWorkflowRunByIdempotencyKey(env, {
      workflowName: MaterializeSandboxProfileVersionSnapshotWorkflowSpec.name,
      idempotencyKey: JSON.stringify({
        version: 1,
        snapshotJobId: snapshotJob.id,
      }),
    });
    expect(snapshotWorkflowRun).toEqual(
      expect.objectContaining({
        workflow_name: MaterializeSandboxProfileVersionSnapshotWorkflowSpec.name,
        input: expect.objectContaining({
          snapshotPreparationScriptKind: "setup",
          image: expect.objectContaining({
            imageId: "registry:3",
            kind: "base",
          }),
        }),
      }),
    );
  });

  it("redispatches a stale failed Tensorlake snapshot refresh enqueue", async ({ env }) => {
    await seedSnapshotRefreshScheduledAction({
      env,
      organizationId: "org_integration_new_schedule_batch_tensorlake_retry",
      profileId: "sbp_integration_new_schedule_batch_tensorlake_retry",
      profileVersion: 1,
      scheduleId: "sch_integration_new_schedule_batch_tensorlake_retry",
      scheduledActionId: "sca_integration_new_schedule_batch_tensorlake_retry",
      sandboxProvider: "tensorlake",
      sandboxVcpuCount: 2,
      sandboxMemoryMb: 4096,
      sandboxDiskMb: 8192,
      maintenanceScript: "echo maintain",
      snapshotImageProvider: "tensorlake",
      snapshotImageId: "tensorlake:snapshot:stale-refresh-retry",
      scheduledActionStatus: ScheduledActionStatuses.DISPATCHING,
      dispatchClaimKey: "schedule-dispatch-batch:previous-child",
      dispatchingAt: "2026-04-28T00:30:00.000Z",
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionSnapshotJobs)
      .values({
        id: "ssj_integration_new_schedule_batch_tensorlake_retry",
        sandboxProfileId: "sbp_integration_new_schedule_batch_tensorlake_retry",
        sandboxProfileVersion: 1,
        sandboxInstanceId: "sbi_integration_new_schedule_batch_tensorlake_retry",
        trigger: SandboxProfileVersionSnapshotJobTriggers.SCHEDULED_REFRESH,
        state: SandboxProfileVersionSnapshotJobStates.FAILED,
        sourceScheduledActionId: "sca_integration_new_schedule_batch_tensorlake_retry",
        workflowRunId: null,
        errorCode: "snapshot_materialization_enqueue_failed",
        errorMessage: "previous enqueue failed",
        finishedAt: "2026-04-28T00:31:00.000Z",
      });

    const result = await dispatchScheduledAction(createDispatchContext(env), {
      scheduledActionId: "sca_integration_new_schedule_batch_tensorlake_retry",
      dispatchClaimKey: "schedule-dispatch-batch:integration-new-tensorlake-retry",
      staleDispatchingBefore: new Date("2026-04-28T01:00:00.000Z"),
    });

    expect(result).toEqual({
      scheduledActionId: "sca_integration_new_schedule_batch_tensorlake_retry",
      status: "dispatched",
    });

    const snapshotJob = await env.controlPlaneDb.query.sandboxProfileVersionSnapshotJobs.findFirst({
      where: (table, { eq }) => eq(table.id, "ssj_integration_new_schedule_batch_tensorlake_retry"),
    });
    expect(snapshotJob).toEqual(
      expect.objectContaining({
        state: SandboxProfileVersionSnapshotJobStates.QUEUED,
        errorCode: null,
        errorMessage: null,
        finishedAt: null,
      }),
    );

    const snapshotWorkflowRun = await readDataPlaneWorkflowRunByIdempotencyKey(env, {
      workflowName: MaterializeSandboxProfileVersionSnapshotWorkflowSpec.name,
      idempotencyKey: JSON.stringify({
        version: 1,
        snapshotJobId: "ssj_integration_new_schedule_batch_tensorlake_retry",
      }),
    });
    expect(snapshotWorkflowRun).toEqual(
      expect.objectContaining({
        workflow_name: MaterializeSandboxProfileVersionSnapshotWorkflowSpec.name,
        input: expect.objectContaining({
          snapshotPreparationScriptKind: "maintenance",
          image: expect.objectContaining({
            imageId: "tensorlake:snapshot:stale-refresh-retry",
            kind: "snapshot",
            provider: "tensorlake",
          }),
          sandboxRuntime: {
            provider: "tensorlake",
            resources: {
              vcpuCount: 2,
              memoryMb: 4096,
              diskMb: 8192,
            },
          },
        }),
      }),
    );

    const persistedAction = await env.controlPlaneDb.query.scheduledActions.findFirst({
      where: (table, { eq }) => eq(table.id, "sca_integration_new_schedule_batch_tensorlake_retry"),
    });
    expect(persistedAction).toEqual(
      expect.objectContaining({
        status: ScheduledActionStatuses.DISPATCHED,
        targetWorkflowId: expect.any(String),
      }),
    );
  });

  it("assigns a sandbox instance id when dispatching a queued scheduled snapshot job created before the column existed", async ({
    env,
  }) => {
    await seedSnapshotRefreshScheduledAction({
      env,
      organizationId: "org_integration_new_schedule_batch_snapshot_legacy",
      profileId: "sbp_integration_new_schedule_batch_snapshot_legacy",
      profileVersion: 1,
      scheduleId: "sch_integration_new_schedule_batch_snapshot_legacy",
      scheduledActionId: "sca_integration_new_schedule_batch_snapshot_legacy",
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionSnapshotJobs)
      .values({
        id: "ssj_integration_new_schedule_batch_snapshot_legacy",
        sandboxProfileId: "sbp_integration_new_schedule_batch_snapshot_legacy",
        sandboxProfileVersion: 1,
        sandboxInstanceId: null,
        trigger: SandboxProfileVersionSnapshotJobTriggers.SCHEDULED_REFRESH,
        state: SandboxProfileVersionSnapshotJobStates.QUEUED,
        sourceScheduledActionId: "sca_integration_new_schedule_batch_snapshot_legacy",
        workflowRunId: null,
      });

    const result = await dispatchScheduledAction(createDispatchContext(env), {
      scheduledActionId: "sca_integration_new_schedule_batch_snapshot_legacy",
      dispatchClaimKey: "schedule-dispatch-batch:integration-new-snapshot-legacy",
      staleDispatchingBefore: new Date("2026-04-28T01:00:00.000Z"),
    });

    expect(result).toEqual({
      scheduledActionId: "sca_integration_new_schedule_batch_snapshot_legacy",
      status: "dispatched",
    });

    const snapshotJob = await env.controlPlaneDb.query.sandboxProfileVersionSnapshotJobs.findFirst({
      where: (table, { eq }) => eq(table.id, "ssj_integration_new_schedule_batch_snapshot_legacy"),
    });
    expect(snapshotJob).toEqual(
      expect.objectContaining({
        sandboxInstanceId: expect.any(String),
        workflowRunId: null,
      }),
    );

    const persistedAction = await env.controlPlaneDb.query.scheduledActions.findFirst({
      where: (table, { eq }) => eq(table.id, "sca_integration_new_schedule_batch_snapshot_legacy"),
    });
    expect(persistedAction).toEqual(
      expect.objectContaining({
        status: ScheduledActionStatuses.DISPATCHED,
        targetWorkflowId: expect.any(String),
      }),
    );
  });
});

async function seedTriggerSchedule(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  triggerId: string;
  scheduleId: string;
  triggerEnabled?: boolean;
  includeTriggerTarget?: boolean;
  includeScheduleTrigger?: boolean;
  scheduleDeletedAt?: string | null;
  scheduleEnabled?: boolean;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.organizations).values({
    id: input.organizationId,
    name: input.organizationId,
    slug: input.organizationId,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.triggers).values({
    id: input.triggerId,
    organizationId: input.organizationId,
    kind: TriggerKinds.SCHEDULE,
    name: input.triggerId,
    enabled: input.triggerEnabled ?? true,
  });
  if (input.includeTriggerTarget ?? false) {
    const sandboxProfileId = `sbp_${input.triggerId}`;
    await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values({
      id: sandboxProfileId,
      organizationId: input.organizationId,
      displayName: sandboxProfileId,
      status: "active",
    });
    await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.triggerTargets).values({
      id: `atg_${input.triggerId}`,
      triggerId: input.triggerId,
      sandboxProfileId,
      sandboxProfileVersion: 1,
    });
  }
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.schedules).values({
    id: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.TRIGGER_RUN,
    name: input.scheduleId,
    cronExpression: "0 9 * * *",
    timezone: "Asia/Singapore",
    enabled: input.scheduleEnabled ?? true,
    nextScheduledAt: "2026-04-29T01:00:00.000Z",
    deletedAt: input.scheduleDeletedAt,
  });
  if (input.includeScheduleTrigger ?? true) {
    await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.scheduleTriggers).values({
      scheduleId: input.scheduleId,
      triggerId: input.triggerId,
      inputTemplate: "{}",
      conversationKeyTemplate: `conversation-${input.scheduleId}`,
      idempotencyKeyTemplate: `idempotency-${input.scheduleId}`,
    });
  }
}

async function seedScheduledAction(input: {
  env: IntegrationTestEnvironment;
  id: string;
  organizationId: string;
  scheduleId: string;
  status?: (typeof ScheduledActionStatuses)[keyof typeof ScheduledActionStatuses];
  dispatchClaimKey?: string | null;
  dispatchingAt?: string | null;
  scheduledAt?: string;
  localScheduledTime?: string;
  targetPayloadTriggerId?: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.scheduledActions).values({
    id: input.id,
    scheduleId: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.TRIGGER_RUN,
    targetPayload: {
      triggerId: input.targetPayloadTriggerId ?? "atm_integration_new_schedule_batch_claim",
    },
    scheduledAt: input.scheduledAt ?? "2030-01-01T00:00:00.000Z",
    localScheduledDate: "2026-04-28",
    localScheduledTime: input.localScheduledTime ?? "08:00",
    status: input.status ?? ScheduledActionStatuses.PENDING,
    dispatchClaimKey: input.dispatchClaimKey,
    dispatchingAt: input.dispatchingAt,
  });
}

async function seedSnapshotRefreshScheduledAction(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  profileId: string;
  profileVersion: number;
  scheduleId: string;
  scheduledActionId: string;
  sandboxProvider?: "docker" | "e2b" | "tensorlake";
  sandboxVcpuCount?: number | null;
  sandboxMemoryMb?: number | null;
  sandboxDiskMb?: number | null;
  maintenanceScript?: string | null;
  snapshotImageProvider?: "docker" | "e2b" | "tensorlake" | null;
  snapshotImageId?: string | null;
  scheduledActionStatus?: (typeof ScheduledActionStatuses)[keyof typeof ScheduledActionStatuses];
  dispatchClaimKey?: string | null;
  dispatchingAt?: string | null;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.organizations).values({
    id: input.organizationId,
    name: input.organizationId,
    slug: input.organizationId,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values({
    id: input.profileId,
    organizationId: input.organizationId,
    displayName: input.profileId,
    status: "active",
  });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersions)
    .values({
      sandboxProfileId: input.profileId,
      version: input.profileVersion,
      sandboxProvider: input.sandboxProvider ?? "docker",
      sandboxConnectionId: null,
      sandboxVcpuCount: input.sandboxVcpuCount ?? null,
      sandboxMemoryMb: input.sandboxMemoryMb ?? null,
      sandboxDiskMb: input.sandboxDiskMb ?? null,
      ...(input.maintenanceScript === undefined
        ? {}
        : { maintenanceScript: input.maintenanceScript }),
      ...(input.snapshotImageProvider === undefined
        ? {}
        : { snapshotImageProvider: input.snapshotImageProvider }),
      ...(input.snapshotImageId === undefined ? {} : { snapshotImageId: input.snapshotImageId }),
    });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.schedules).values({
    id: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
    name: input.scheduleId,
    cronExpression: "0 9 * * *",
    timezone: "Asia/Singapore",
    enabled: true,
    nextScheduledAt: "2026-04-29T01:00:00.000Z",
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.scheduledActions).values({
    id: input.scheduledActionId,
    scheduleId: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
    targetPayload: {
      sandboxProfileId: input.profileId,
      sandboxProfileVersion: input.profileVersion,
    },
    scheduledAt: "2026-04-28T01:00:00.000Z",
    localScheduledDate: "2026-04-28",
    localScheduledTime: "09:00",
    status: input.scheduledActionStatus ?? ScheduledActionStatuses.PENDING,
    dispatchClaimKey: input.dispatchClaimKey,
    dispatchingAt: input.dispatchingAt,
  });
}

function createDispatchContext(env: IntegrationTestEnvironment) {
  return {
    db: env.controlPlaneDb,
    dataPlaneClient: createDataPlaneSandboxInstancesClient({
      baseUrl: env.dataPlaneApi.hostBaseUrl,
      serviceToken: "integration-new-internal-service-token",
      testEnvironmentId: env.id,
      testEnvironmentIdHeader: TestEnvironmentIdHeader,
    }),
    defaultBaseImage: "registry:3",
    openWorkflow: env.controlPlaneWorkflow,
  };
}

type WorkflowRunRow = {
  id: string;
  workflow_name: string;
  status: string;
  input: unknown;
  idempotency_key: string | null;
};

const WorkflowRunRowSchema = z
  .object({
    id: z.string(),
    workflow_name: z.string(),
    status: z.string(),
    input: z.unknown(),
    idempotency_key: z.string().nullable(),
  })
  .strict();

async function readControlPlaneWorkflowRunByIdempotencyKey(
  env: IntegrationTestEnvironment,
  input: {
    workflowName: string;
    idempotencyKey: string;
  },
): Promise<WorkflowRunRow | undefined> {
  const result = await env.controlPlaneDb.execute(sql<WorkflowRunRow>`
    select id, workflow_name, status, input, idempotency_key
    from control_plane_openworkflow.workflow_runs
    where
      namespace_id = ${createControlPlaneWorkflowNamespaceId(env.id)}
      and workflow_name = ${input.workflowName}
      and idempotency_key = ${input.idempotencyKey}
    order by created_at asc
  `);

  const row = result.rows[0];
  return row === undefined ? undefined : WorkflowRunRowSchema.parse(row);
}

async function readDataPlaneWorkflowRunByIdempotencyKey(
  env: IntegrationTestEnvironment,
  input: {
    workflowName: string;
    idempotencyKey: string;
  },
): Promise<WorkflowRunRow | undefined> {
  const result = await env.controlPlaneDb.execute(sql<WorkflowRunRow>`
    select id, workflow_name, status, input, idempotency_key
    from data_plane_openworkflow.workflow_runs
    where
      namespace_id = ${createDataPlaneWorkflowNamespaceId(env.id)}
      and workflow_name = ${input.workflowName}
      and idempotency_key = ${input.idempotencyKey}
    order by created_at asc
  `);

  const row = result.rows[0];
  return row === undefined ? undefined : WorkflowRunRowSchema.parse(row);
}
