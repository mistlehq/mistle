import {
  createDataPlaneSandboxInstancesClient,
  type ResumeSandboxInstanceInput,
} from "@mistle/data-plane-internal-client";
import {
  sandboxInstanceRuntimePlans,
  sandboxInstances,
  SandboxInstanceStatuses,
  SandboxInstanceVolumeModes,
} from "@mistle/db/data-plane";
import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";
import { z } from "zod";

import { it, type DataPlaneApiIntegrationFixture } from "./test-context.js";

type WorkflowRunRow = {
  id: string;
  namespace_id: string;
  workflow_name: string;
  status: string;
  input: unknown;
  output: null;
};

const WorkflowRunInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
  })
  .loose();

const WorkflowName = "data-plane.sandbox-instances.resume";
const WorkflowQueuePollIntervalMs = 100;
const WorkflowQueueWaitTimeoutMs = 10_000;

function createRuntimePlan() {
  return {
    sandboxProfileId: "sbp_resume_integration",
    version: 1,
    image: {
      source: "base" as const,
      imageRef: "registry:resume",
    },
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: [],
    agentRuntimes: [],
  };
}

function createSandboxInstancesClient(
  baseUrl: string,
  serviceToken: string,
): ReturnType<typeof createDataPlaneSandboxInstancesClient> {
  return createDataPlaneSandboxInstancesClient({
    baseUrl,
    serviceToken,
  });
}

async function insertStoppedSandboxInstance(input: {
  fixture: DataPlaneApiIntegrationFixture;
  organizationId: string;
  sandboxInstanceId: string;
  providerRuntimeId: string;
  instanceVolumeId: string;
}): Promise<void> {
  await input.fixture.db.insert(sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: "sbp_resume_integration",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerRuntimeId: input.providerRuntimeId,
    instanceVolumeProvider: "docker",
    instanceVolumeId: input.instanceVolumeId,
    instanceVolumeMode: SandboxInstanceVolumeModes.NATIVE,
    status: SandboxInstanceStatuses.STOPPED,
    startedByKind: "user",
    startedById: "usr_resume_integration",
    source: "dashboard",
  });

  await input.fixture.db.insert(sandboxInstanceRuntimePlans).values({
    sandboxInstanceId: input.sandboxInstanceId,
    revision: 1,
    compiledRuntimePlan: createRuntimePlan(),
    compiledFromProfileId: "sbp_resume_integration",
    compiledFromProfileVersion: 1,
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
    `Timed out waiting for queued resume workflow run for sandbox instance '${input.sandboxInstanceId}'.`,
  );
}

describe("sandboxInstances.resume integration", () => {
  it("returns an accepted resume response and queues a workflow run", async ({ fixture }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const sandboxInstanceId = "sbi_dp_api_resume_integration_001";
    const workflowInput: ResumeSandboxInstanceInput = {
      organizationId: "org_dp_api_resume_integration_001",
      instanceId: sandboxInstanceId,
    };

    await insertStoppedSandboxInstance({
      fixture,
      organizationId: workflowInput.organizationId,
      sandboxInstanceId,
      providerRuntimeId: "provider-runtime-resume-integration-001",
      instanceVolumeId: "volume-resume-integration-001",
    });

    const resumedSandbox = await client.resumeSandboxInstance(workflowInput);

    expect(resumedSandbox.status).toBe("accepted");
    expect(resumedSandbox.sandboxInstanceId).toBe(sandboxInstanceId);
    expect(resumedSandbox.workflowRunId).not.toBe("");

    const workflowRuns = await waitForWorkflowRuns({
      runQuery: async (instanceId) => {
        const result = await fixture.dbPool.query<WorkflowRunRow>(
          `
            select id, namespace_id, workflow_name, status, input, output
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
      throw new Error("Expected queued resume workflow run row to exist.");
    }

    expect(queuedRun.id).toBe(resumedSandbox.workflowRunId);
    expect(queuedRun.namespace_id).toBe(fixture.config.workflow.namespaceId);
    expect(queuedRun.workflow_name).toBe(WorkflowName);
    expect(queuedRun.status).toBe("pending");
    expect(queuedRun.output).toBeNull();

    const parsedWorkflowInput = WorkflowRunInputSchema.parse(queuedRun.input);
    expect(parsedWorkflowInput.sandboxInstanceId).toBe(sandboxInstanceId);
  }, 60_000);

  it("deduplicates duplicate resume requests by idempotency key", async ({ fixture }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const sandboxInstanceId = "sbi_dp_api_resume_integration_idempotent";
    const workflowInput: ResumeSandboxInstanceInput = {
      organizationId: "org_dp_api_resume_integration_idempotent",
      instanceId: sandboxInstanceId,
      idempotencyKey: "dashboard-resume-001",
    };

    await insertStoppedSandboxInstance({
      fixture,
      organizationId: workflowInput.organizationId,
      sandboxInstanceId,
      providerRuntimeId: "provider-runtime-resume-integration-002",
      instanceVolumeId: "volume-resume-integration-002",
    });

    const firstResponse = await client.resumeSandboxInstance(workflowInput);
    const secondResponse = await client.resumeSandboxInstance(workflowInput);

    expect(secondResponse).toEqual(firstResponse);

    const workflowRuns = await waitForWorkflowRuns({
      runQuery: async (instanceId) => {
        const result = await fixture.dbPool.query<WorkflowRunRow>(
          `
            select id, namespace_id, workflow_name, status, input, output
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
