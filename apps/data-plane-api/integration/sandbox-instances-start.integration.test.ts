import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";
import { DATA_PLANE_INTERNAL_AUTH_HEADER } from "@mistle/data-plane-trpc/constants";
import type { StartSandboxInstanceInput } from "@mistle/data-plane-trpc/contracts";
import { SandboxInstanceStatuses, sandboxInstances } from "@mistle/db/data-plane";
import { systemSleeper } from "@mistle/time";
import { httpBatchLink } from "@trpc/client";
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
    artifactRemovals: [],
    runtimeClients: [],
  };
}

function createSandboxInstancesClient(
  baseUrl: string,
  serviceToken: string,
  requestTimeoutMs?: number,
): ReturnType<typeof createDataPlaneSandboxInstancesClient> {
  return createDataPlaneSandboxInstancesClient({
    baseUrl,
    serviceToken,
    ...(requestTimeoutMs === undefined
      ? {}
      : {
          links: [
            httpBatchLink({
              url: new URL("/trpc", baseUrl).toString(),
              headers: {
                [DATA_PLANE_INTERNAL_AUTH_HEADER]: serviceToken,
              },
              fetch: async (url, options) => {
                const controller = new AbortController();
                let requestCompleted = false;

                void systemSleeper.sleep(requestTimeoutMs).then(() => {
                  if (!requestCompleted) {
                    controller.abort();
                  }
                });

                const requestInit: RequestInit = {
                  ...(options?.body === undefined
                    ? {}
                    : {
                        body: options.body,
                      }),
                  ...(options?.headers === undefined
                    ? {}
                    : {
                        headers: options.headers,
                      }),
                  ...(options?.method === undefined
                    ? {}
                    : {
                        method: options.method,
                      }),
                  signal: controller.signal,
                };

                try {
                  return await fetch(url, requestInit);
                } finally {
                  requestCompleted = true;
                }
              },
            }),
          ],
        }),
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
    const client = createSandboxInstancesClient(
      fixture.baseUrl,
      fixture.internalAuthServiceToken,
      1_000,
    );
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
        kind: "base",
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

  it("uses caller-specified sandboxInstanceId when provided", async ({ fixture }) => {
    const client = createSandboxInstancesClient(
      fixture.baseUrl,
      fixture.internalAuthServiceToken,
      1_000,
    );
    const sandboxProfileId = "sbp_dp_api_integration_explicit_id";
    const workflowInput: StartSandboxInstanceInput = {
      sandboxInstanceId: "sbi_dp_api_integration_explicit_id",
      organizationId: "org_dp_api_integration_explicit_id",
      sandboxProfileId,
      sandboxProfileVersion: 5,
      runtimePlan: createRuntimePlan({
        sandboxProfileId,
        version: 5,
      }),
      startedBy: {
        kind: "system",
        id: "aru_dp_api_integration_explicit_id",
      },
      source: "webhook",
      image: {
        imageId: "im_dp_api_integration_explicit_id",
        kind: "base",
        createdAt: "2026-03-07T00:00:00.000Z",
      },
    };

    const startedSandbox = await client.startSandboxInstance(workflowInput);
    expect(startedSandbox.status).toBe("accepted");
    expect(startedSandbox.sandboxInstanceId).toBe("sbi_dp_api_integration_explicit_id");

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
    const queuedWorkflowInput = WorkflowRunInputSchema.parse(queuedWorkflowRuns[0]?.input);
    expect(queuedWorkflowInput.sandboxInstanceId).toBe("sbi_dp_api_integration_explicit_id");
  }, 60_000);

  it("deduplicates duplicate start requests by idempotency key", async ({ fixture }) => {
    const client = createSandboxInstancesClient(
      fixture.baseUrl,
      fixture.internalAuthServiceToken,
      1_000,
    );
    const sandboxProfileId = "sbp_dp_api_integration_idempotent";
    const workflowInput: StartSandboxInstanceInput = {
      organizationId: "org_dp_api_integration_idempotent",
      sandboxProfileId,
      sandboxProfileVersion: 11,
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
        kind: "base",
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
    const client = createSandboxInstancesClient(
      fixture.baseUrl,
      fixture.internalAuthServiceToken,
      1_000,
    );
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
        kind: "base",
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
        providerSandboxId: true,
        status: true,
      },
      where: (table, { eq }) => eq(table.id, startedSandbox.sandboxInstanceId),
    });

    expect(persistedSandboxInstance).toEqual({
      id: startedSandbox.sandboxInstanceId,
      organizationId: workflowInput.organizationId,
      sandboxProfileId: workflowInput.sandboxProfileId,
      sandboxProfileVersion: workflowInput.sandboxProfileVersion,
      providerSandboxId: null,
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

  it("promotes a stopped sandbox instance to starting immediately for explicit restart", async ({
    fixture,
  }) => {
    const client = createSandboxInstancesClient(
      fixture.baseUrl,
      fixture.internalAuthServiceToken,
      1_000,
    );
    const sandboxInstanceId = "sbi_dp_api_sync_restart";
    const workflowInput: StartSandboxInstanceInput = {
      sandboxInstanceId,
      organizationId: "org_dp_api_sync_restart",
      sandboxProfileId: "sbp_dp_api_sync_restart",
      sandboxProfileVersion: 4,
      runtimePlan: createRuntimePlan({
        sandboxProfileId: "sbp_dp_api_sync_restart",
        version: 4,
      }),
      startedBy: {
        kind: "system",
        id: "aru_dp_api_sync_restart",
      },
      source: "webhook",
      image: {
        imageId: "im_dp_api_sync_restart",
        kind: "base",
        createdAt: "2026-03-07T00:00:00.000Z",
      },
    };

    await fixture.db.insert(sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: workflowInput.organizationId,
      sandboxProfileId: workflowInput.sandboxProfileId,
      sandboxProfileVersion: workflowInput.sandboxProfileVersion,
      provider: "docker",
      providerSandboxId: "provider_sandbox_old",
      status: SandboxInstanceStatuses.STOPPED,
      startedByKind: "system",
      startedById: "aru_dp_api_sync_restart_previous",
      source: "webhook",
      startedAt: "2026-03-06T23:00:00.000Z",
      stoppedAt: "2026-03-07T00:00:00.000Z",
      failedAt: null,
      failureCode: null,
      failureMessage: null,
    });

    const startedSandbox = await client.startSandboxInstance(workflowInput);
    expect(startedSandbox.status).toBe("accepted");
    expect(startedSandbox.sandboxInstanceId).toBe(sandboxInstanceId);

    const persistedSandboxInstance = await fixture.db.query.sandboxInstances.findFirst({
      columns: {
        id: true,
        status: true,
        providerSandboxId: true,
        stoppedAt: true,
        failedAt: true,
        failureCode: true,
        failureMessage: true,
      },
      where: (table, { eq }) => eq(table.id, sandboxInstanceId),
    });

    expect(persistedSandboxInstance).toEqual({
      id: sandboxInstanceId,
      status: SandboxInstanceStatuses.STARTING,
      providerSandboxId: null,
      stoppedAt: null,
      failedAt: null,
      failureCode: null,
      failureMessage: null,
    });
  }, 60_000);
});
