/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createHash } from "node:crypto";

import {
  createDataPlaneSandboxInstancesClient,
  type DataPlaneSandboxInstancesClient,
  type ReconcileSandboxInstanceInput,
  type StopSandboxInstanceInput,
} from "@mistle/data-plane-internal-client";
import {
  SandboxInstanceDeadlineKinds,
  SandboxInstancePurposes,
  SandboxInstanceStatuses,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import { createDataPlaneWorkflowNamespaceId } from "@mistle/db/test-environment";
import {
  TestEnvironmentIdHeader,
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { systemClock, systemSleeper } from "@mistle/time";
import {
  DeleteSandboxInstanceWorkflowName,
  ReconcileSandboxInstanceWorkflowName,
  StopSandboxInstanceWorkflowName,
} from "@mistle/workflow-registry/data-plane";
import { sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import { z } from "zod";

const InternalServiceToken = "integration-new-internal-service-token";
type IdleStopSandboxInstanceInput = Extract<StopSandboxInstanceInput, { stopReason: "idle" }>;
type UserStopSandboxInstanceInput = Extract<StopSandboxInstanceInput, { stopReason: "user" }>;
const WorkflowRunPersistTimeoutMs = 30_000;
const WorkflowRunPersistPollIntervalMs = 100;

const it = createIntegrationTest({
  services: ["data-plane-api"],
});

const StopWorkflowInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    stopReason: z.literal("idle"),
    expectedOwnerLeaseId: z.string().min(1),
  })
  .strict();

const StopWorkflowIdempotencyKeySchema = z
  .object({
    version: z.literal(1),
    sandboxInstanceId: z.string().min(1),
    action: z.literal("stop"),
    stopReason: z.literal("idle"),
    expectedOwnerLeaseId: z.string().min(1),
    idempotencyKey: z.string().min(1),
  })
  .strict();

const UserStopWorkflowInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    stopReason: z.literal("user"),
  })
  .strict();

const UserStopWorkflowIdempotencyKeySchema = z
  .object({
    version: z.literal(1),
    sandboxInstanceId: z.string().min(1),
    action: z.literal("user_stop"),
    organizationId: z.string().min(1),
    idempotencyKey: z.string().min(1),
  })
  .strict();

const DeleteSandboxDestroyWorkflowIdempotencyKeySchema = z
  .object({
    version: z.literal(1),
    sandboxInstanceId: z.string().min(1),
    action: z.literal("delete_sandbox_destroy"),
    organizationId: z.string().min(1),
  })
  .strict();

const ReconcileWorkflowInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    reason: z.literal("disconnect_grace_elapsed"),
    expectedOwnerLeaseId: z.string().min(1),
  })
  .strict();

describe.concurrent("internal sandbox instance workflow queue integration", () => {
  it("queues a stop workflow with the request payload and idempotency key", async ({ env }) => {
    const workflowInput: IdleStopSandboxInstanceInput = {
      sandboxInstanceId: "sbi_dp_api_workflow_stop",
      stopReason: "idle",
      expectedOwnerLeaseId: "sol_dp_api_workflow_stop",
      idempotencyKey: "gateway-stop-integration-new",
    };

    await insertRunningSandboxInstance(env, {
      sandboxInstanceId: workflowInput.sandboxInstanceId,
      organizationId: "org_dp_api_workflow_stop",
      sandboxProfileId: "sbp_dp_api_workflow_stop",
    });
    await insertIdleDeadline(env, {
      sandboxInstanceId: workflowInput.sandboxInstanceId,
      ownerLeaseId: workflowInput.expectedOwnerLeaseId,
    });

    const firstResponse = await clientFor(env).stopSandboxInstance(workflowInput);
    const secondResponse = await clientFor(env).stopSandboxInstance(workflowInput);

    expect(firstResponse).toEqual({
      status: "accepted",
      sandboxInstanceId: workflowInput.sandboxInstanceId,
      workflowRunId: expect.any(String),
    });
    expect(secondResponse).toEqual(firstResponse);
    await expectSandboxStatus(
      env,
      workflowInput.sandboxInstanceId,
      SandboxInstanceStatuses.STOPPING,
    );

    const workflowRuns = await waitForQueuedWorkflowRuns({
      env,
      sandboxInstanceId: workflowInput.sandboxInstanceId,
      workflowName: StopSandboxInstanceWorkflowName,
    });

    expect(workflowRuns).toHaveLength(1);
    expect(workflowRuns[0]).toEqual({
      id: firstResponse.workflowRunId,
      namespace_id: createDataPlaneWorkflowNamespaceId(env.id),
      workflow_name: StopSandboxInstanceWorkflowName,
      status: "pending",
      input: workflowInputForStop(workflowInput),
      output: null,
      idempotency_key: JSON.stringify({
        version: 1,
        sandboxInstanceId: workflowInput.sandboxInstanceId,
        action: "stop",
        stopReason: workflowInput.stopReason,
        expectedOwnerLeaseId: workflowInput.expectedOwnerLeaseId,
        idempotencyKey: workflowInput.idempotencyKey,
      }),
    });
    expect(StopWorkflowInputSchema.parse(workflowRuns[0]?.input)).toEqual(
      workflowInputForStop(workflowInput),
    );
    expect(
      StopWorkflowIdempotencyKeySchema.parse(JSON.parse(workflowRuns[0]?.idempotency_key ?? "")),
    ).toEqual({
      version: 1,
      sandboxInstanceId: workflowInput.sandboxInstanceId,
      action: "stop",
      stopReason: workflowInput.stopReason,
      expectedOwnerLeaseId: workflowInput.expectedOwnerLeaseId,
      idempotencyKey: workflowInput.idempotencyKey,
    });
  });

  it("rejects a stale idle stop without queueing workflow work or marking stopping", async ({
    env,
  }) => {
    const workflowInput: IdleStopSandboxInstanceInput = {
      sandboxInstanceId: "sbi_dp_api_workflow_stale_idle_stop",
      stopReason: "idle",
      expectedOwnerLeaseId: "sol_dp_api_workflow_stale_idle_stop",
      idempotencyKey: "gateway-stale-idle-stop-integration-new",
    };

    await insertRunningSandboxInstance(env, {
      sandboxInstanceId: workflowInput.sandboxInstanceId,
      organizationId: "org_dp_api_workflow_stale_idle_stop",
      sandboxProfileId: "sbp_dp_api_workflow_stale_idle_stop",
    });

    await expect(clientFor(env).stopSandboxInstance(workflowInput)).rejects.toMatchObject({
      status: 409,
    });
    await expectSandboxStatus(
      env,
      workflowInput.sandboxInstanceId,
      SandboxInstanceStatuses.RUNNING,
    );
    await expect(
      countQueuedWorkflowRuns({
        env,
        sandboxInstanceIds: [workflowInput.sandboxInstanceId],
        workflowName: StopSandboxInstanceWorkflowName,
      }),
    ).resolves.toBe(0);
  });

  it("queues a reconcile workflow with the request payload and idempotency key", async ({
    env,
  }) => {
    const workflowInput: ReconcileSandboxInstanceInput = {
      sandboxInstanceId: "sbi_dp_api_workflow_reconcile",
      reason: "disconnect_grace_elapsed",
      expectedOwnerLeaseId: "sol_dp_api_workflow_reconcile",
      idempotencyKey: "gateway-reconcile-integration-new",
    };

    await insertRunningSandboxInstance(env, {
      sandboxInstanceId: workflowInput.sandboxInstanceId,
      organizationId: "org_dp_api_workflow_reconcile",
      sandboxProfileId: "sbp_dp_api_workflow_reconcile",
    });

    const firstResponse = await clientFor(env).reconcileSandboxInstance(workflowInput);
    const secondResponse = await clientFor(env).reconcileSandboxInstance(workflowInput);

    expect(firstResponse).toEqual({
      status: "accepted",
      sandboxInstanceId: workflowInput.sandboxInstanceId,
      workflowRunId: expect.any(String),
    });
    expect(secondResponse).toEqual(firstResponse);

    const workflowRuns = await waitForQueuedWorkflowRuns({
      env,
      sandboxInstanceId: workflowInput.sandboxInstanceId,
      workflowName: ReconcileSandboxInstanceWorkflowName,
    });

    expect(workflowRuns).toHaveLength(1);
    expect(workflowRuns[0]).toEqual({
      id: firstResponse.workflowRunId,
      namespace_id: createDataPlaneWorkflowNamespaceId(env.id),
      workflow_name: ReconcileSandboxInstanceWorkflowName,
      status: "pending",
      input: workflowInputForReconcile(workflowInput),
      output: null,
      idempotency_key: createExpectedReconcileIdempotencyKey(workflowInput),
    });
    expect(ReconcileWorkflowInputSchema.parse(workflowRuns[0]?.input)).toEqual(
      workflowInputForReconcile(workflowInput),
    );
  });

  it("queues a user stop workflow for running and reconnecting session and setup sandboxes", async ({
    env,
  }) => {
    const workflowInput: UserStopSandboxInstanceInput = {
      organizationId: "org_dp_api_workflow_user_stop",
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop",
      stopReason: "user",
      idempotencyKey: "dashboard-user-stop-integration-new",
    };

    await insertRunningSandboxInstance(env, {
      sandboxInstanceId: workflowInput.sandboxInstanceId,
      organizationId: workflowInput.organizationId,
      sandboxProfileId: "sbp_dp_api_workflow_user_stop",
      purpose: SandboxInstancePurposes.SETUP_CHECK,
    });
    await insertRunningSandboxInstance(env, {
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop_session",
      organizationId: workflowInput.organizationId,
      sandboxProfileId: "sbp_dp_api_workflow_user_stop_session",
      purpose: SandboxInstancePurposes.SESSION,
    });
    await insertRunningSandboxInstance(env, {
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop_reconnecting_session",
      organizationId: workflowInput.organizationId,
      sandboxProfileId: "sbp_dp_api_workflow_user_stop_reconnecting_session",
      status: SandboxInstanceStatuses.RECONNECTING,
      purpose: SandboxInstancePurposes.SESSION,
    });
    await insertRunningSandboxInstance(env, {
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop_assistant",
      organizationId: workflowInput.organizationId,
      sandboxProfileId: "sbp_dp_api_workflow_user_stop_assistant",
      purpose: SandboxInstancePurposes.SETUP_ASSISTANT,
    });

    const firstResponse = await clientFor(env).stopSandboxInstance(workflowInput);
    const secondResponse = await clientFor(env).stopSandboxInstance(workflowInput);
    const setupAssistantResponse = await clientFor(env).stopSandboxInstance({
      organizationId: workflowInput.organizationId,
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop_assistant",
      stopReason: "user",
      idempotencyKey: "dashboard-user-stop-assistant-integration-new",
    });
    const sessionResponse = await clientFor(env).stopSandboxInstance({
      organizationId: workflowInput.organizationId,
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop_session",
      stopReason: "user",
      idempotencyKey: "dashboard-user-stop-session-integration-new",
    });
    const reconnectingSessionResponse = await clientFor(env).stopSandboxInstance({
      organizationId: workflowInput.organizationId,
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop_reconnecting_session",
      stopReason: "user",
      idempotencyKey: "dashboard-user-stop-reconnecting-session-integration-new",
    });

    expect(firstResponse).toEqual({
      status: "accepted",
      sandboxInstanceId: workflowInput.sandboxInstanceId,
      workflowRunId: expect.any(String),
    });
    expect(secondResponse).toEqual(firstResponse);

    const workflowRuns = await waitForQueuedWorkflowRuns({
      env,
      sandboxInstanceId: workflowInput.sandboxInstanceId,
      workflowName: StopSandboxInstanceWorkflowName,
    });

    expect(workflowRuns).toHaveLength(1);
    expect(workflowRuns[0]).toEqual({
      id: firstResponse.workflowRunId,
      namespace_id: createDataPlaneWorkflowNamespaceId(env.id),
      workflow_name: StopSandboxInstanceWorkflowName,
      status: "pending",
      input: workflowInputForUserStop(workflowInput),
      output: null,
      idempotency_key: JSON.stringify({
        version: 1,
        sandboxInstanceId: workflowInput.sandboxInstanceId,
        action: "user_stop",
        organizationId: workflowInput.organizationId,
        idempotencyKey: workflowInput.idempotencyKey,
      }),
    });
    expect(UserStopWorkflowInputSchema.parse(workflowRuns[0]?.input)).toEqual(
      workflowInputForUserStop(workflowInput),
    );
    expect(
      UserStopWorkflowIdempotencyKeySchema.parse(
        JSON.parse(workflowRuns[0]?.idempotency_key ?? ""),
      ),
    ).toEqual({
      version: 1,
      sandboxInstanceId: workflowInput.sandboxInstanceId,
      action: "user_stop",
      organizationId: workflowInput.organizationId,
      idempotencyKey: workflowInput.idempotencyKey,
    });

    const setupAssistantWorkflowRuns = await waitForQueuedWorkflowRuns({
      env,
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop_assistant",
      workflowName: StopSandboxInstanceWorkflowName,
    });
    expect(setupAssistantWorkflowRuns).toHaveLength(1);
    expect(UserStopWorkflowInputSchema.parse(setupAssistantWorkflowRuns[0]?.input)).toEqual({
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop_assistant",
      stopReason: "user",
    });
    expect(setupAssistantWorkflowRuns[0]?.id).toBe(setupAssistantResponse.workflowRunId);

    const sessionWorkflowRuns = await waitForQueuedWorkflowRuns({
      env,
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop_session",
      workflowName: StopSandboxInstanceWorkflowName,
    });
    expect(sessionWorkflowRuns).toHaveLength(1);
    expect(UserStopWorkflowInputSchema.parse(sessionWorkflowRuns[0]?.input)).toEqual({
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop_session",
      stopReason: "user",
    });
    expect(sessionWorkflowRuns[0]?.id).toBe(sessionResponse.workflowRunId);

    const reconnectingSessionWorkflowRuns = await waitForQueuedWorkflowRuns({
      env,
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop_reconnecting_session",
      workflowName: StopSandboxInstanceWorkflowName,
    });
    expect(reconnectingSessionWorkflowRuns).toHaveLength(1);
    expect(UserStopWorkflowInputSchema.parse(reconnectingSessionWorkflowRuns[0]?.input)).toEqual({
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop_reconnecting_session",
      stopReason: "user",
    });
    expect(reconnectingSessionWorkflowRuns[0]?.id).toBe(reconnectingSessionResponse.workflowRunId);
  });

  it("rejects user stop workflows for snapshot sandbox instances", async ({ env }) => {
    await insertRunningSandboxInstance(env, {
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop_snapshot",
      organizationId: "org_dp_api_workflow_user_stop_snapshot",
      sandboxProfileId: "sbp_dp_api_workflow_user_stop_snapshot",
      purpose: SandboxInstancePurposes.SNAPSHOT,
    });

    await expect(
      clientFor(env).stopSandboxInstance({
        organizationId: "org_dp_api_workflow_user_stop_snapshot",
        sandboxInstanceId: "sbi_dp_api_workflow_user_stop_snapshot",
        stopReason: "user",
        idempotencyKey: "dashboard-user-stop-snapshot-integration-new",
      }),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  it("deletes a running session and queues provider destruction before hiding it from reads", async ({
    env,
  }) => {
    await insertRunningSandboxInstance(env, {
      sandboxInstanceId: "sbi_dp_api_workflow_delete_running_session",
      organizationId: "org_dp_api_workflow_delete_running_session",
      sandboxProfileId: "sbp_dp_api_workflow_delete_running_session",
      purpose: SandboxInstancePurposes.SESSION,
    });

    const firstResponse = await clientFor(env).deleteSandboxInstance({
      organizationId: "org_dp_api_workflow_delete_running_session",
      sandboxInstanceId: "sbi_dp_api_workflow_delete_running_session",
    });
    const secondResponse = await clientFor(env).deleteSandboxInstance({
      organizationId: "org_dp_api_workflow_delete_running_session",
      sandboxInstanceId: "sbi_dp_api_workflow_delete_running_session",
    });

    expect(firstResponse).toEqual({
      status: "deleted",
      sandboxInstanceId: "sbi_dp_api_workflow_delete_running_session",
      workflowRunId: expect.any(String),
    });
    expect(secondResponse).toEqual({
      status: "already_deleted",
      sandboxInstanceId: "sbi_dp_api_workflow_delete_running_session",
      workflowRunId: null,
    });

    await expect(
      clientFor(env).getSandboxInstance({
        organizationId: "org_dp_api_workflow_delete_running_session",
        instanceId: "sbi_dp_api_workflow_delete_running_session",
      }),
    ).resolves.toBeNull();

    const persisted = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      columns: {
        deletedAt: true,
        status: true,
      },
      where: (table, { eq }) => eq(table.id, "sbi_dp_api_workflow_delete_running_session"),
    });
    expect(persisted?.deletedAt).not.toBeNull();
    expect(persisted?.status).toBe(SandboxInstanceStatuses.RUNNING);

    const workflowRuns = await waitForQueuedWorkflowRuns({
      env,
      sandboxInstanceId: "sbi_dp_api_workflow_delete_running_session",
      workflowName: DeleteSandboxInstanceWorkflowName,
    });

    expect(workflowRuns).toHaveLength(1);
    expect(workflowRuns[0]).toMatchObject({
      id: firstResponse.workflowRunId,
      input: {
        sandboxInstanceId: "sbi_dp_api_workflow_delete_running_session",
      },
    });
    expect(
      DeleteSandboxDestroyWorkflowIdempotencyKeySchema.parse(
        JSON.parse(workflowRuns[0]?.idempotency_key ?? ""),
      ),
    ).toEqual({
      version: 1,
      sandboxInstanceId: "sbi_dp_api_workflow_delete_running_session",
      action: "delete_sandbox_destroy",
      organizationId: "org_dp_api_workflow_delete_running_session",
    });
  });

  it("deletes a non-session sandbox and queues provider destruction", async ({ env }) => {
    await insertRunningSandboxInstance(env, {
      sandboxInstanceId: "sbi_dp_api_workflow_delete_skills_discovery",
      organizationId: "org_dp_api_workflow_delete_skills_discovery",
      sandboxProfileId: "sbp_dp_api_workflow_delete_skills_discovery",
      purpose: SandboxInstancePurposes.SKILLS_DISCOVERY,
    });

    const response = await clientFor(env).deleteSandboxInstance({
      organizationId: "org_dp_api_workflow_delete_skills_discovery",
      sandboxInstanceId: "sbi_dp_api_workflow_delete_skills_discovery",
    });

    expect(response).toEqual({
      status: "deleted",
      sandboxInstanceId: "sbi_dp_api_workflow_delete_skills_discovery",
      workflowRunId: expect.any(String),
    });

    const workflowRuns = await waitForQueuedWorkflowRuns({
      env,
      sandboxInstanceId: "sbi_dp_api_workflow_delete_skills_discovery",
      workflowName: DeleteSandboxInstanceWorkflowName,
    });

    expect(workflowRuns).toHaveLength(1);
    expect(workflowRuns[0]).toMatchObject({
      id: response.workflowRunId,
      input: {
        sandboxInstanceId: "sbi_dp_api_workflow_delete_skills_discovery",
      },
    });
  });

  it("deletes a stopped session and still queues provider destruction", async ({ env }) => {
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(
      sandboxInstanceRow({
        id: "sbi_dp_api_workflow_delete_stopped_session",
        organizationId: "org_dp_api_workflow_delete_stopped_session",
        sandboxProfileId: "sbp_dp_api_workflow_delete_stopped_session",
        status: SandboxInstanceStatuses.STOPPED,
        purpose: SandboxInstancePurposes.SESSION,
      }),
    );

    const response = await clientFor(env).deleteSandboxInstance({
      organizationId: "org_dp_api_workflow_delete_stopped_session",
      sandboxInstanceId: "sbi_dp_api_workflow_delete_stopped_session",
    });

    expect(response).toEqual({
      status: "deleted",
      sandboxInstanceId: "sbi_dp_api_workflow_delete_stopped_session",
      workflowRunId: expect.any(String),
    });

    const workflowRuns = await waitForQueuedWorkflowRuns({
      env,
      sandboxInstanceId: "sbi_dp_api_workflow_delete_stopped_session",
      workflowName: DeleteSandboxInstanceWorkflowName,
    });

    expect(workflowRuns).toHaveLength(1);
    expect(workflowRuns[0]).toMatchObject({
      id: response.workflowRunId,
      input: {
        sandboxInstanceId: "sbi_dp_api_workflow_delete_stopped_session",
      },
    });
  });

  it("returns terminal user stop statuses without queueing duplicate workflows", async ({
    env,
  }) => {
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values([
      sandboxInstanceRow({
        id: "sbi_dp_api_workflow_user_stop_stopped",
        organizationId: "org_dp_api_workflow_user_stop_terminal",
        sandboxProfileId: "sbp_dp_api_workflow_user_stop_stopped",
        status: SandboxInstanceStatuses.STOPPED,
        purpose: SandboxInstancePurposes.SETUP_CHECK,
      }),
      sandboxInstanceRow({
        id: "sbi_dp_api_workflow_user_stop_failed",
        organizationId: "org_dp_api_workflow_user_stop_terminal",
        sandboxProfileId: "sbp_dp_api_workflow_user_stop_failed",
        status: SandboxInstanceStatuses.FAILED,
        purpose: SandboxInstancePurposes.SETUP_CHECK,
      }),
    ]);

    await expect(
      clientFor(env).stopSandboxInstance({
        organizationId: "org_dp_api_workflow_user_stop_terminal",
        sandboxInstanceId: "sbi_dp_api_workflow_user_stop_stopped",
        stopReason: "user",
        idempotencyKey: "dashboard-user-stop-stopped-integration-new",
      }),
    ).resolves.toEqual({
      status: "already_stopped",
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop_stopped",
      workflowRunId: null,
    });
    await expect(
      clientFor(env).stopSandboxInstance({
        organizationId: "org_dp_api_workflow_user_stop_terminal",
        sandboxInstanceId: "sbi_dp_api_workflow_user_stop_failed",
        stopReason: "user",
        idempotencyKey: "dashboard-user-stop-failed-integration-new",
      }),
    ).resolves.toEqual({
      status: "already_terminal",
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop_failed",
      workflowRunId: null,
    });

    await expect(
      countQueuedWorkflowRuns({
        env,
        sandboxInstanceIds: [
          "sbi_dp_api_workflow_user_stop_stopped",
          "sbi_dp_api_workflow_user_stop_failed",
        ],
        workflowName: StopSandboxInstanceWorkflowName,
      }),
    ).resolves.toBe(0);
  });
});

function clientFor(env: IntegrationTestEnvironment): DataPlaneSandboxInstancesClient {
  return createDataPlaneSandboxInstancesClient({
    baseUrl: env.dataPlaneApi.hostBaseUrl,
    serviceToken: InternalServiceToken,
    testEnvironmentId: env.id,
    testEnvironmentIdHeader: TestEnvironmentIdHeader,
  });
}

async function insertRunningSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    sandboxInstanceId: string;
    organizationId: string;
    sandboxProfileId: string;
    status?: typeof SandboxInstanceStatuses.RUNNING | typeof SandboxInstanceStatuses.RECONNECTING;
    purpose?:
      | typeof SandboxInstancePurposes.SESSION
      | typeof SandboxInstancePurposes.SNAPSHOT
      | typeof SandboxInstancePurposes.SETUP_ASSISTANT
      | typeof SandboxInstancePurposes.SETUP_CHECK
      | typeof SandboxInstancePurposes.SKILLS_DISCOVERY;
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(
    sandboxInstanceRow({
      id: input.sandboxInstanceId,
      organizationId: input.organizationId,
      sandboxProfileId: input.sandboxProfileId,
      status: input.status ?? SandboxInstanceStatuses.RUNNING,
      ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    }),
  );
}

async function insertIdleDeadline(
  env: IntegrationTestEnvironment,
  input: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceDeadlines).values({
    sandboxInstanceId: input.sandboxInstanceId,
    kind: SandboxInstanceDeadlineKinds.IDLE,
    ownerLeaseId: input.ownerLeaseId,
    dueAt: "2026-05-16T00:00:00.000Z",
  });
}

async function expectSandboxStatus(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
  status: string,
): Promise<void> {
  const persisted = await env.dataPlaneDb.query.sandboxInstances.findFirst({
    columns: {
      status: true,
    },
    where: (table, { eq }) => eq(table.id, sandboxInstanceId),
  });

  expect(persisted?.status).toBe(status);
}

function sandboxInstanceRow(input: {
  id: string;
  organizationId: string;
  sandboxProfileId: string;
  status:
    | typeof SandboxInstanceStatuses.RUNNING
    | typeof SandboxInstanceStatuses.RECONNECTING
    | typeof SandboxInstanceStatuses.STOPPED
    | typeof SandboxInstanceStatuses.FAILED;
  purpose?:
    | typeof SandboxInstancePurposes.SESSION
    | typeof SandboxInstancePurposes.SNAPSHOT
    | typeof SandboxInstancePurposes.SETUP_ASSISTANT
    | typeof SandboxInstancePurposes.SETUP_CHECK
    | typeof SandboxInstancePurposes.SKILLS_DISCOVERY;
}): DataPlaneTables["sandboxInstances"]["$inferInsert"] {
  return {
    id: input.id,
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.id}`,
    status: input.status,
    startedByKind: "user",
    startedById: "usr_dp_api_workflow",
    source: "dashboard",
    ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
  };
}

type WorkflowRunRow = {
  id: string;
  namespace_id: string;
  workflow_name: string;
  status: string;
  input: unknown;
  output: null;
  idempotency_key: string | null;
};

const WorkflowRunRowSchema = z
  .object({
    id: z.string(),
    namespace_id: z.string(),
    workflow_name: z.string(),
    status: z.string(),
    input: z.unknown(),
    output: z.null(),
    idempotency_key: z.string().nullable(),
  })
  .strict();

async function waitForQueuedWorkflowRuns(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
  workflowName: string;
}): Promise<WorkflowRunRow[]> {
  const deadline = systemClock.nowMs() + WorkflowRunPersistTimeoutMs;
  const namespaceId = createDataPlaneWorkflowNamespaceId(input.env.id);

  while (systemClock.nowMs() < deadline) {
    const result = await input.env.dataPlaneDb.execute(sql<WorkflowRunRow>`
      select id, namespace_id, workflow_name, status, input, output, idempotency_key
      from data_plane_openworkflow.workflow_runs
      where
        namespace_id = ${namespaceId}
        and workflow_name = ${input.workflowName}
        and input->>'sandboxInstanceId' = ${input.sandboxInstanceId}
      order by created_at asc
    `);

    if (result.rows.length > 0) {
      return result.rows.map((row) => WorkflowRunRowSchema.parse(row));
    }

    await systemSleeper.sleep(WorkflowRunPersistPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued workflow '${input.workflowName}' for sandbox '${input.sandboxInstanceId}'.`,
  );
}

async function countQueuedWorkflowRuns(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceIds: readonly string[];
  workflowName: string;
}): Promise<number> {
  const namespaceId = createDataPlaneWorkflowNamespaceId(input.env.id);
  let count = 0;

  for (const sandboxInstanceId of input.sandboxInstanceIds) {
    const result = await input.env.dataPlaneDb.execute(sql<{ count: string }>`
      select count(*)::text as count
      from data_plane_openworkflow.workflow_runs
      where
        namespace_id = ${namespaceId}
        and workflow_name = ${input.workflowName}
        and input->>'sandboxInstanceId' = ${sandboxInstanceId}
    `);

    count += Number(result.rows[0]?.count ?? "0");
  }

  return count;
}

function workflowInputForStop(input: IdleStopSandboxInstanceInput) {
  return {
    sandboxInstanceId: input.sandboxInstanceId,
    stopReason: input.stopReason,
    expectedOwnerLeaseId: input.expectedOwnerLeaseId,
  };
}

function workflowInputForReconcile(input: ReconcileSandboxInstanceInput) {
  return {
    sandboxInstanceId: input.sandboxInstanceId,
    reason: input.reason,
    expectedOwnerLeaseId: input.expectedOwnerLeaseId,
  };
}

function workflowInputForUserStop(input: UserStopSandboxInstanceInput) {
  return {
    sandboxInstanceId: input.sandboxInstanceId,
    stopReason: input.stopReason,
  };
}

function createExpectedReconcileIdempotencyKey(input: ReconcileSandboxInstanceInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        sandboxInstanceId: input.sandboxInstanceId,
        action: "reconcile",
        reason: input.reason,
        expectedOwnerLeaseId: input.expectedOwnerLeaseId,
        idempotencyKey: input.idempotencyKey,
      }),
    )
    .digest("hex");
}
