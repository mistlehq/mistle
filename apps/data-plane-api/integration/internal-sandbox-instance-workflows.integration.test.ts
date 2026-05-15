/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createHash } from "node:crypto";

import {
  createDataPlaneSandboxInstancesClient,
  type DataPlaneSandboxInstancesClient,
  type ReconcileSandboxInstanceInput,
  type StopSandboxInstanceInput,
  type StopUserRequestedSandboxInstanceInput,
} from "@mistle/data-plane-internal-client";
import {
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
  ReconcileSandboxInstanceWorkflowName,
  StopSandboxInstanceWorkflowName,
} from "@mistle/workflow-registry/data-plane";
import { sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import { z } from "zod";

const InternalServiceToken = "integration-new-internal-service-token";
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

const ReconcileWorkflowInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    reason: z.literal("disconnect_grace_elapsed"),
    expectedOwnerLeaseId: z.string().min(1),
  })
  .strict();

describe.concurrent("internal sandbox instance workflow queue integration", () => {
  it("queues a stop workflow with the request payload and idempotency key", async ({ env }) => {
    const workflowInput: StopSandboxInstanceInput = {
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

    const firstResponse = await clientFor(env).stopSandboxInstance(workflowInput);
    const secondResponse = await clientFor(env).stopSandboxInstance(workflowInput);

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

  it("queues a user stop workflow for running setup sandboxes", async ({ env }) => {
    const workflowInput: StopUserRequestedSandboxInstanceInput = {
      organizationId: "org_dp_api_workflow_user_stop",
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop",
      idempotencyKey: "dashboard-user-stop-integration-new",
    };

    await insertRunningSandboxInstance(env, {
      sandboxInstanceId: workflowInput.sandboxInstanceId,
      organizationId: workflowInput.organizationId,
      sandboxProfileId: "sbp_dp_api_workflow_user_stop",
      purpose: SandboxInstancePurposes.SETUP_CHECK,
    });
    await insertRunningSandboxInstance(env, {
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop_assistant",
      organizationId: workflowInput.organizationId,
      sandboxProfileId: "sbp_dp_api_workflow_user_stop_assistant",
      purpose: SandboxInstancePurposes.SETUP_ASSISTANT,
    });

    const firstResponse = await clientFor(env).stopUserRequestedSandboxInstance(workflowInput);
    const secondResponse = await clientFor(env).stopUserRequestedSandboxInstance(workflowInput);
    const setupAssistantResponse = await clientFor(env).stopUserRequestedSandboxInstance({
      organizationId: workflowInput.organizationId,
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop_assistant",
      idempotencyKey: "dashboard-user-stop-assistant-integration-new",
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
  });

  it("rejects user stop workflows for session sandbox instances", async ({ env }) => {
    await insertRunningSandboxInstance(env, {
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop_session",
      organizationId: "org_dp_api_workflow_user_stop_session",
      sandboxProfileId: "sbp_dp_api_workflow_user_stop_session",
      purpose: SandboxInstancePurposes.SESSION,
    });

    await expect(
      clientFor(env).stopUserRequestedSandboxInstance({
        organizationId: "org_dp_api_workflow_user_stop_session",
        sandboxInstanceId: "sbi_dp_api_workflow_user_stop_session",
        idempotencyKey: "dashboard-user-stop-session-integration-new",
      }),
    ).rejects.toMatchObject({
      status: 409,
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
      clientFor(env).stopUserRequestedSandboxInstance({
        organizationId: "org_dp_api_workflow_user_stop_terminal",
        sandboxInstanceId: "sbi_dp_api_workflow_user_stop_stopped",
        idempotencyKey: "dashboard-user-stop-stopped-integration-new",
      }),
    ).resolves.toEqual({
      status: "already_stopped",
      sandboxInstanceId: "sbi_dp_api_workflow_user_stop_stopped",
      workflowRunId: null,
    });
    await expect(
      clientFor(env).stopUserRequestedSandboxInstance({
        organizationId: "org_dp_api_workflow_user_stop_terminal",
        sandboxInstanceId: "sbi_dp_api_workflow_user_stop_failed",
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
    purpose?:
      | typeof SandboxInstancePurposes.SESSION
      | typeof SandboxInstancePurposes.SETUP_ASSISTANT
      | typeof SandboxInstancePurposes.SETUP_CHECK;
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(
    sandboxInstanceRow({
      id: input.sandboxInstanceId,
      organizationId: input.organizationId,
      sandboxProfileId: input.sandboxProfileId,
      status: SandboxInstanceStatuses.RUNNING,
      ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    }),
  );
}

function sandboxInstanceRow(input: {
  id: string;
  organizationId: string;
  sandboxProfileId: string;
  status:
    | typeof SandboxInstanceStatuses.RUNNING
    | typeof SandboxInstanceStatuses.STOPPED
    | typeof SandboxInstanceStatuses.FAILED;
  purpose?:
    | typeof SandboxInstancePurposes.SESSION
    | typeof SandboxInstancePurposes.SETUP_ASSISTANT
    | typeof SandboxInstancePurposes.SETUP_CHECK;
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

function workflowInputForStop(input: StopSandboxInstanceInput) {
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

function workflowInputForUserStop(input: StopUserRequestedSandboxInstanceInput) {
  return {
    sandboxInstanceId: input.sandboxInstanceId,
    stopReason: "user" as const,
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
