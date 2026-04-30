import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  sandboxInstances,
  SandboxInstancePurposes,
  SandboxInstanceStatuses,
} from "@mistle/db/data-plane";
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
    stopReason: z.literal("idle"),
    expectedOwnerLeaseId: z.string().min(1),
  })
  .strict();

const WorkflowRunIdempotencyKeySchema = z
  .object({
    version: z.literal(1),
    sandboxInstanceId: z.string().min(1),
    action: z.literal("stop"),
    stopReason: z.literal("idle"),
    expectedOwnerLeaseId: z.string().min(1),
    idempotencyKey: z.string().min(1),
  })
  .strict();

const WorkflowName = "data-plane.sandbox-instances.stop";
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
    `Timed out waiting for queued setup-check PTY drained workflow run for sandbox instance '${input.sandboxInstanceId}'.`,
  );
}

describe("setup-check PTY drained integration", () => {
  it("queues an idle stop workflow for a running setup-check sandbox", async ({ fixture }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const sandboxInstanceId = "sbi_dp_api_setup_check_pty_drained";
    const ownerLeaseId = "sol_dp_api_setup_check_pty_drained";

    await fixture.db.insert(sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: "org_dp_api_setup_check_pty_drained",
      sandboxProfileId: "sbp_dp_api_setup_check_pty_drained",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-setup-check-pty-drained",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: "usr_dp_api_setup_check_pty_drained",
      source: "dashboard",
      purpose: SandboxInstancePurposes.SETUP_CHECK,
    });

    const response = await client.setupCheckPtyDrained({
      sandboxInstanceId,
      ownerLeaseId,
    });

    expect(response.status).toBe("accepted");
    if (response.status !== "accepted") {
      throw new Error("Expected setup-check PTY drained response to be accepted.");
    }
    expect(response.sandboxInstanceId).toBe(sandboxInstanceId);
    expect(response.workflowRunId).not.toBe("");

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
      throw new Error("Expected queued stop workflow run row to exist.");
    }

    expect(queuedRun.id).toBe(response.workflowRunId);
    expect(queuedRun.namespace_id).toBe(fixture.config.workflow.namespaceId);
    expect(queuedRun.workflow_name).toBe(WorkflowName);
    expect(queuedRun.status).toBe("pending");
    expect(queuedRun.output).toBeNull();
    expect(WorkflowRunInputSchema.parse(queuedRun.input)).toEqual({
      sandboxInstanceId,
      stopReason: "idle",
      expectedOwnerLeaseId: ownerLeaseId,
    });
    expect(
      WorkflowRunIdempotencyKeySchema.parse(JSON.parse(queuedRun.idempotency_key ?? "")),
    ).toEqual({
      version: 1,
      sandboxInstanceId,
      action: "stop",
      stopReason: "idle",
      expectedOwnerLeaseId: ownerLeaseId,
      idempotencyKey: `setup-check-pty-drained:v1:${sandboxInstanceId}:${ownerLeaseId}`,
    });
  }, 60_000);

  it("ignores non-setup-check sandboxes", async ({ fixture }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const sandboxInstanceId = "sbi_dp_api_setup_check_pty_session";

    await fixture.db.insert(sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: "org_dp_api_setup_check_pty_session",
      sandboxProfileId: "sbp_dp_api_setup_check_pty_session",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-setup-check-pty-session",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: "usr_dp_api_setup_check_pty_session",
      source: "dashboard",
      purpose: SandboxInstancePurposes.SESSION,
    });

    const response = await client.setupCheckPtyDrained({
      sandboxInstanceId,
      ownerLeaseId: "sol_dp_api_setup_check_pty_session",
    });

    expect(response).toEqual({
      status: "ignored",
      sandboxInstanceId,
    });
  });
});
