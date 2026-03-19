import {
  createDataPlaneSandboxInstancesClient,
  type ConnectSandboxInstanceInput,
} from "@mistle/data-plane-internal-client";
import {
  sandboxInstanceRuntimePlans,
  sandboxInstances,
  SandboxInstanceStatuses,
  SandboxInstanceVolumeModes,
} from "@mistle/db/data-plane";
import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";

import { it, type DataPlaneApiIntegrationFixture } from "./test-context.js";

type WorkflowRunRow = {
  id: string;
  status: string;
};

const ResumeWorkflowName = "data-plane.sandbox-instances.resume";
const WorkflowQueuePollIntervalMs = 100;
const WorkflowQueueWaitTimeoutMs = 10_000;

function createRuntimePlan() {
  return {
    sandboxProfileId: "sbp_connect_integration",
    version: 1,
    image: {
      source: "base" as const,
      imageRef: "registry:connect",
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
}): Promise<void> {
  await input.fixture.db.insert(sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: "sbp_connect_integration",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerRuntimeId: "provider-runtime-connect-001",
    instanceVolumeProvider: "docker",
    instanceVolumeId: "volume-connect-001",
    instanceVolumeMode: SandboxInstanceVolumeModes.NATIVE,
    status: SandboxInstanceStatuses.STOPPED,
    startedByKind: "user",
    startedById: "usr_connect_integration",
    source: "dashboard",
  });

  await input.fixture.db.insert(sandboxInstanceRuntimePlans).values({
    sandboxInstanceId: input.sandboxInstanceId,
    revision: 1,
    compiledRuntimePlan: createRuntimePlan(),
    compiledFromProfileId: "sbp_connect_integration",
    compiledFromProfileVersion: 1,
  });
}

async function insertRunningSandboxInstance(input: {
  fixture: DataPlaneApiIntegrationFixture;
  organizationId: string;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.fixture.db.insert(sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: "sbp_connect_integration",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerRuntimeId: "provider-runtime-connect-002",
    instanceVolumeProvider: "docker",
    instanceVolumeId: "volume-connect-002",
    instanceVolumeMode: SandboxInstanceVolumeModes.NATIVE,
    status: SandboxInstanceStatuses.RUNNING,
    startedByKind: "user",
    startedById: "usr_connect_integration",
    source: "dashboard",
    activeTunnelLeaseId: "lease-connect-ready",
    tunnelConnectedAt: "2026-03-19T00:00:00.000Z",
    lastTunnelSeenAt: "2026-03-19T00:00:00.000Z",
    tunnelDisconnectedAt: null,
  });
}

async function waitForResumeWorkflowRun(input: {
  fixture: DataPlaneApiIntegrationFixture;
  sandboxInstanceId: string;
}): Promise<WorkflowRunRow> {
  const deadline = Date.now() + WorkflowQueueWaitTimeoutMs;

  while (Date.now() < deadline) {
    const result = await input.fixture.dbPool.query<WorkflowRunRow>(
      `
        select id, status
        from data_plane_openworkflow.workflow_runs
        where
          namespace_id = $1
          and workflow_name = $2
          and input->>'sandboxInstanceId' = $3
        order by created_at asc
        limit 1
      `,
      [input.fixture.config.workflow.namespaceId, ResumeWorkflowName, input.sandboxInstanceId],
    );

    const row = result.rows[0];
    if (row !== undefined) {
      return row;
    }

    await systemSleeper.sleep(WorkflowQueuePollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued resume workflow run for sandbox instance '${input.sandboxInstanceId}'.`,
  );
}

describe("sandboxInstances.connect integration", () => {
  it("returns ready for running sandboxes with a live tunnel", async ({ fixture }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const workflowInput: ConnectSandboxInstanceInput = {
      organizationId: "org_dp_api_connect_ready_001",
      instanceId: "sbi_dp_api_connect_ready_001",
    };

    await insertRunningSandboxInstance({
      fixture,
      organizationId: workflowInput.organizationId,
      sandboxInstanceId: workflowInput.instanceId,
    });

    const response = await client.getSandboxConnectStatus(workflowInput);

    expect(response).toEqual({
      instanceId: workflowInput.instanceId,
      status: "ready",
      code: null,
      message: null,
    });
  });

  it("queues resume work for stopped sandboxes and returns pending", async ({ fixture }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const workflowInput: ConnectSandboxInstanceInput = {
      organizationId: "org_dp_api_connect_pending_001",
      instanceId: "sbi_dp_api_connect_pending_001",
    };

    await insertStoppedSandboxInstance({
      fixture,
      organizationId: workflowInput.organizationId,
      sandboxInstanceId: workflowInput.instanceId,
    });

    const response = await client.connectSandboxInstance(workflowInput);

    expect(response).toEqual({
      instanceId: workflowInput.instanceId,
      status: "pending",
      code: null,
      message: null,
    });

    const workflowRun = await waitForResumeWorkflowRun({
      fixture,
      sandboxInstanceId: workflowInput.instanceId,
    });

    expect(workflowRun.status).toBe("pending");
  }, 60_000);
});
