import {
  createDataPlaneSandboxInstancesClient,
  type StartSandboxInstanceInput,
} from "@mistle/data-plane-internal-client";
import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
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
};

const WorkflowRunInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    organizationId: z.string().min(1),
    sandboxProfileId: z.string().min(1),
  })
  .loose();

const WorkflowName = "data-plane.sandbox-instances.start";
const WorkflowQueuePollIntervalMs = 100;
const WorkflowQueueWaitTimeoutMs = 10_000;

function createRuntimePlan(input: {
  sandboxProfileId: string;
  version: number;
}): StartSandboxInstanceInput["runtimePlan"] {
  return {
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    image: {
      source: "base",
      imageRef: "registry:3",
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

async function waitForWorkflowRuns(input: {
  runQuery: (organizationId: string, sandboxProfileId: string) => Promise<WorkflowRunRow[]>;
  organizationId: string;
  sandboxProfileId: string;
}): Promise<WorkflowRunRow[]> {
  const deadline = Date.now() + WorkflowQueueWaitTimeoutMs;

  while (Date.now() < deadline) {
    const workflowRuns = await input.runQuery(input.organizationId, input.sandboxProfileId);
    if (workflowRuns.length > 0) {
      return workflowRuns;
    }

    await systemSleeper.sleep(WorkflowQueuePollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued workflow run for organization '${input.organizationId}' and profile '${input.sandboxProfileId}'.`,
  );
}

describe("sandboxInstances.start integration", () => {
  it("returns an accepted start response and queues a workflow run", async ({ fixture }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const sandboxProfileId = "sbp_dp_api_integration_001";
    const workflowInput: StartSandboxInstanceInput = {
      organizationId: "org_dp_api_integration_001",
      sandboxProfileId,
      sandboxProfileVersion: 7,
      runtimePlan: createRuntimePlan({
        sandboxProfileId,
        version: 7,
      }),
      startedBy: {
        kind: "user",
        id: "usr_dp_api_integration_001",
      },
      source: "dashboard",
      image: {
        imageId: "im_dp_api_integration_001",
        createdAt: "2026-02-27T00:00:00.000Z",
      },
    };

    const startedSandbox = await client.startSandboxInstance(workflowInput);

    expect(startedSandbox.status).toBe("accepted");
    expect(startedSandbox.sandboxInstanceId).toMatch(/^sbi_[a-zA-Z0-9_-]+$/);
    expect(startedSandbox.workflowRunId).not.toBe("");

    const workflowRuns = await waitForWorkflowRuns({
      runQuery: async (organizationId, profileId) => {
        const result = await fixture.dbPool.query<WorkflowRunRow>(
          `
            select id, namespace_id, workflow_name, status, input, output
            from data_plane_openworkflow.workflow_runs
            where
              namespace_id = $1
              and workflow_name = $2
              and input->>'organizationId' = $3
              and input->>'sandboxProfileId' = $4
            order by created_at asc
          `,
          [fixture.config.workflow.namespaceId, WorkflowName, organizationId, profileId],
        );
        return result.rows;
      },
      organizationId: workflowInput.organizationId,
      sandboxProfileId: workflowInput.sandboxProfileId,
    });

    expect(workflowRuns).toHaveLength(1);
    const queuedRun = workflowRuns[0];
    if (queuedRun === undefined) {
      throw new Error("Expected queued workflow run row to exist.");
    }
    expect(queuedRun.id).toBe(startedSandbox.workflowRunId);
    expect(queuedRun.namespace_id).toBe(fixture.config.workflow.namespaceId);
    expect(queuedRun.workflow_name).toBe(WorkflowName);
    expect(queuedRun.status).toBe("pending");
    expect(queuedRun.output).toBeNull();

    const parsedWorkflowInput = WorkflowRunInputSchema.parse(queuedRun.input);
    expect(parsedWorkflowInput.organizationId).toBe(workflowInput.organizationId);
    expect(parsedWorkflowInput.sandboxProfileId).toBe(workflowInput.sandboxProfileId);
    expect(parsedWorkflowInput.sandboxInstanceId).toBe(startedSandbox.sandboxInstanceId);
  }, 60_000);

  it("deduplicates duplicate start requests by idempotency key", async ({ fixture }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const sandboxProfileId = "sbp_dp_api_integration_idempotent";
    const workflowInput: StartSandboxInstanceInput = {
      organizationId: "org_dp_api_integration_idempotent",
      sandboxProfileId,
      sandboxProfileVersion: 11,
      idempotencyKey: "dashboard-start-001",
      runtimePlan: createRuntimePlan({
        sandboxProfileId,
        version: 11,
      }),
      startedBy: {
        kind: "user",
        id: "usr_dp_api_integration_idempotent",
      },
      source: "dashboard",
      image: {
        imageId: "im_dp_api_integration_idempotent",
        createdAt: "2026-02-27T00:00:00.000Z",
      },
    };

    const firstStartedSandbox = await client.startSandboxInstance(workflowInput);
    const secondStartedSandbox = await client.startSandboxInstance(workflowInput);

    expect(secondStartedSandbox).toEqual(firstStartedSandbox);

    const queuedWorkflowRuns = await waitForWorkflowRuns({
      runQuery: async (organizationId, profileId) => {
        const result = await fixture.dbPool.query<WorkflowRunRow>(
          `
            select id, namespace_id, workflow_name, status, input, output
            from data_plane_openworkflow.workflow_runs
            where
              namespace_id = $1
              and workflow_name = $2
              and input->>'organizationId' = $3
              and input->>'sandboxProfileId' = $4
            order by created_at asc
          `,
          [fixture.config.workflow.namespaceId, WorkflowName, organizationId, profileId],
        );
        return result.rows;
      },
      organizationId: workflowInput.organizationId,
      sandboxProfileId: workflowInput.sandboxProfileId,
    });

    expect(queuedWorkflowRuns).toHaveLength(1);
    expect(queuedWorkflowRuns[0]?.id).toBe(firstStartedSandbox.workflowRunId);
  }, 60_000);

  it("creates a starting sandbox instance row immediately after start is accepted", async ({
    fixture,
  }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const sandboxProfileId = "sbp_dp_api_sync_insert";
    const workflowInput: StartSandboxInstanceInput = {
      organizationId: "org_dp_api_sync_insert",
      sandboxProfileId,
      sandboxProfileVersion: 1,
      runtimePlan: createRuntimePlan({
        sandboxProfileId,
        version: 1,
      }),
      startedBy: {
        kind: "user",
        id: "usr_dp_api_sync_insert",
      },
      source: "dashboard",
      image: {
        imageId: "im_dp_api_sync_insert",
        createdAt: "2026-02-27T00:00:00.000Z",
      },
    };

    const startedSandbox = await client.startSandboxInstance(workflowInput);

    const persistedSandboxInstance = await fixture.db.query.sandboxInstances.findFirst({
      columns: {
        id: true,
        organizationId: true,
        sandboxProfileId: true,
        sandboxProfileVersion: true,
        providerRuntimeId: true,
        status: true,
      },
      where: (table, { eq }) => eq(table.id, startedSandbox.sandboxInstanceId),
    });

    expect(persistedSandboxInstance).toEqual({
      id: startedSandbox.sandboxInstanceId,
      organizationId: workflowInput.organizationId,
      sandboxProfileId: workflowInput.sandboxProfileId,
      sandboxProfileVersion: workflowInput.sandboxProfileVersion,
      providerRuntimeId: null,
      status: SandboxInstanceStatuses.STARTING,
    });

    const persistedRuntimePlans = await fixture.db.query.sandboxInstanceRuntimePlans.findMany({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.sandboxInstanceId, startedSandbox.sandboxInstanceId),
    });
    expect(persistedRuntimePlans).toHaveLength(0);
  }, 60_000);
});
