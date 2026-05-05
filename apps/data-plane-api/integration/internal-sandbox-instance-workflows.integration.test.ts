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
import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
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
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.RUNNING,
    startedByKind: "user",
    startedById: "usr_dp_api_workflow",
    source: "dashboard",
  });
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
