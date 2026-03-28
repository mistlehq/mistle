import {
  createDataPlaneSandboxInstancesClient,
  type ReconcileSandboxInstanceInput,
} from "@mistle/data-plane-internal-client";
import { sandboxInstances, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";
import { z } from "zod";

import { it } from "./test-context.js";

type WorkflowRunRow = {
  id: string;
  namespace_id: string;
  workflow_name: string;
  status: string;
  input: unknown;
  output: null;
  idempotency_key: string | null;
};

const WorkflowRunInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    reason: z.literal("disconnect_grace_elapsed"),
    expectedOwnerLeaseId: z.string().min(1),
  })
  .strict();

const WorkflowRunIdempotencyKeySchema = z
  .object({
    version: z.literal(1),
    sandboxInstanceId: z.string().min(1),
    action: z.literal("reconcile"),
    reason: z.literal("disconnect_grace_elapsed"),
    expectedOwnerLeaseId: z.string().min(1),
    idempotencyKey: z.string().min(1),
  })
  .strict();

const WorkflowName = "data-plane.sandbox-instances.reconcile";
const WorkflowQueuePollIntervalMs = 100;
const WorkflowQueueWaitTimeoutMs = 10_000;

function createSandboxInstancesClient(
  baseUrl: string,
  serviceToken: string,
): ReturnType<typeof createDataPlaneSandboxInstancesClient> {
  return createDataPlaneSandboxInstancesClient({
    baseUrl,
    serviceToken,
  });
}

async function waitForWorkflowRuns(input: {
  runQuery: (sandboxInstanceId: string) => Promise<WorkflowRunRow[]>;
  sandboxInstanceId: string;
}): Promise<WorkflowRunRow[]> {
  const deadline = Date.now() + WorkflowQueueWaitTimeoutMs;

  while (Date.now() < deadline) {
    const workflowRuns = await input.runQuery(input.sandboxInstanceId);
    if (workflowRuns.length > 0) {
      return workflowRuns;
    }

    await systemSleeper.sleep(WorkflowQueuePollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued reconcile workflow run for sandbox instance '${input.sandboxInstanceId}'.`,
  );
}

describe("sandboxInstances.reconcile integration", () => {
  it("returns an accepted reconcile response, queues a workflow run, and preserves idempotency inputs", async ({
    fixture,
  }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const sandboxInstanceId = "sbi_dp_api_reconcile_integration_001";
    const workflowInput: ReconcileSandboxInstanceInput = {
      sandboxInstanceId,
      reason: "disconnect_grace_elapsed",
      expectedOwnerLeaseId: "sol_dp_api_reconcile_integration_001",
      idempotencyKey: "gateway-reconcile-001",
    };

    await fixture.db.insert(sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: "org_dp_api_reconcile_integration_001",
      sandboxProfileId: "sbp_dp_api_reconcile_integration_001",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-runtime-reconcile-integration-001",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: "usr_dp_api_reconcile_integration_001",
      source: "dashboard",
    });

    const reconciledSandbox = await client.reconcileSandboxInstance(workflowInput);

    expect(reconciledSandbox.status).toBe("accepted");
    expect(reconciledSandbox.sandboxInstanceId).toBe(sandboxInstanceId);
    expect(reconciledSandbox.workflowRunId).not.toBe("");

    const workflowRuns = await waitForWorkflowRuns({
      runQuery: async (instanceId) => {
        const result = await fixture.dbPool.query<WorkflowRunRow>(
          `
            select id, namespace_id, workflow_name, status, input, output, idempotency_key
            from data_plane_openworkflow.workflow_runs
            where
              namespace_id = $1
              and workflow_name = $2
              and input->>'sandboxInstanceId' = $3
            order by created_at asc
          `,
          [fixture.config.workflow.namespaceId, WorkflowName, instanceId],
        );
        return result.rows;
      },
      sandboxInstanceId,
    });

    expect(workflowRuns).toHaveLength(1);
    const queuedRun = workflowRuns[0];
    if (queuedRun === undefined) {
      throw new Error("Expected queued reconcile workflow run row to exist.");
    }

    expect(queuedRun.id).toBe(reconciledSandbox.workflowRunId);
    expect(queuedRun.namespace_id).toBe(fixture.config.workflow.namespaceId);
    expect(queuedRun.workflow_name).toBe(WorkflowName);
    expect(queuedRun.status).toBe("pending");
    expect(queuedRun.output).toBeNull();

    const parsedWorkflowInput = WorkflowRunInputSchema.parse(queuedRun.input);
    expect(parsedWorkflowInput).toEqual({
      sandboxInstanceId,
      reason: workflowInput.reason,
      expectedOwnerLeaseId: workflowInput.expectedOwnerLeaseId,
    });
    expect(
      WorkflowRunIdempotencyKeySchema.parse(JSON.parse(queuedRun.idempotency_key ?? "")),
    ).toEqual({
      version: 1,
      sandboxInstanceId,
      action: "reconcile",
      reason: workflowInput.reason,
      expectedOwnerLeaseId: workflowInput.expectedOwnerLeaseId,
      idempotencyKey: workflowInput.idempotencyKey,
    });
  }, 60_000);

  it("deduplicates duplicate reconcile requests by idempotency key", async ({ fixture }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const sandboxInstanceId = "sbi_dp_api_reconcile_integration_idempotent";
    const workflowInput: ReconcileSandboxInstanceInput = {
      sandboxInstanceId,
      reason: "disconnect_grace_elapsed",
      expectedOwnerLeaseId: "sol_dp_api_reconcile_integration_idempotent",
      idempotencyKey: "gateway-reconcile-idempotent-001",
    };

    await fixture.db.insert(sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: "org_dp_api_reconcile_integration_idempotent",
      sandboxProfileId: "sbp_dp_api_reconcile_integration_idempotent",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-runtime-reconcile-integration-idempotent",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: "usr_dp_api_reconcile_integration_idempotent",
      source: "dashboard",
    });

    const firstResponse = await client.reconcileSandboxInstance(workflowInput);
    const secondResponse = await client.reconcileSandboxInstance(workflowInput);

    expect(secondResponse).toEqual(firstResponse);

    const workflowRuns = await waitForWorkflowRuns({
      runQuery: async (instanceId) => {
        const result = await fixture.dbPool.query<WorkflowRunRow>(
          `
            select id, namespace_id, workflow_name, status, input, output, idempotency_key
            from data_plane_openworkflow.workflow_runs
            where
              namespace_id = $1
              and workflow_name = $2
              and input->>'sandboxInstanceId' = $3
            order by created_at asc
          `,
          [fixture.config.workflow.namespaceId, WorkflowName, instanceId],
        );
        return result.rows;
      },
      sandboxInstanceId,
    });

    expect(workflowRuns).toHaveLength(1);
    expect(workflowRuns[0]?.id).toBe(firstResponse.workflowRunId);
  }, 60_000);
});
