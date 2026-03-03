import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";
import { DATA_PLANE_INTERNAL_AUTH_HEADER } from "@mistle/data-plane-trpc/constants";
import type { StartSandboxInstanceInput } from "@mistle/data-plane-trpc/contracts";
import { systemSleeper } from "@mistle/time";
import { httpBatchLink } from "@trpc/client";
import { describe, expect } from "vitest";

import { it } from "./test-context.js";

type WorkflowRunRow = {
  id: string;
  namespace_id: string;
  workflow_name: string;
  status: string;
  input: StartSandboxInstanceInput;
  output: null;
};

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
  it("queues a start workflow run without synchronous completion", async ({ fixture }) => {
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

    const startRequestPromise = client.startSandboxInstance(workflowInput);
    void startRequestPromise.catch(() => undefined);

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
    expect(queuedRun.namespace_id).toBe(fixture.config.workflow.namespaceId);
    expect(queuedRun.workflow_name).toBe(WorkflowName);
    expect(queuedRun.status).toBe("pending");
    expect(queuedRun.input).toEqual(workflowInput);
    expect(queuedRun.output).toBeNull();

    const settledWithinShortWindow = await Promise.race([
      startRequestPromise.then(
        () => true,
        () => true,
      ),
      systemSleeper.sleep(500).then(() => false),
    ]);
    expect(settledWithinShortWindow).toBe(false);
  }, 60_000);

  it("deduplicates duplicate start requests by idempotency key while queued", async ({
    fixture,
  }) => {
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

    const firstStartRequestPromise = client.startSandboxInstance(workflowInput);
    const secondStartRequestPromise = client.startSandboxInstance(workflowInput);
    void firstStartRequestPromise.catch(() => undefined);
    void secondStartRequestPromise.catch(() => undefined);

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
    expect(queuedWorkflowRuns[0]?.status).toBe("pending");
  }, 60_000);

  it("does not insert sandbox instance rows before workflow execution", async ({ fixture }) => {
    const client = createSandboxInstancesClient(
      fixture.baseUrl,
      fixture.internalAuthServiceToken,
      1_000,
    );
    const sandboxProfileId = "sbp_dp_api_no_sync_insert";
    const workflowInput: StartSandboxInstanceInput = {
      organizationId: "org_dp_api_no_sync_insert",
      sandboxProfileId,
      sandboxProfileVersion: 1,
      runtimePlan: createRuntimePlan({
        sandboxProfileId,
        version: 1,
      }),
      startedBy: {
        kind: "user",
        id: "usr_dp_api_no_sync_insert",
      },
      source: "dashboard",
      image: {
        imageId: "im_dp_api_no_sync_insert",
        kind: "base",
        createdAt: "2026-02-27T00:00:00.000Z",
      },
    };

    const startRequestPromise = client.startSandboxInstance(workflowInput);
    void startRequestPromise.catch(() => undefined);

    await waitForWorkflowRuns({
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

    const persistedSandboxInstances = await fixture.db.query.sandboxInstances.findMany({
      columns: {
        id: true,
      },
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, workflowInput.organizationId),
          eq(table.sandboxProfileId, workflowInput.sandboxProfileId),
        ),
    });
    expect(persistedSandboxInstances).toHaveLength(0);

    const persistedRuntimePlans = await fixture.db.query.sandboxInstanceRuntimePlans.findMany({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.compiledFromProfileId, workflowInput.sandboxProfileId),
    });
    expect(persistedRuntimePlans).toHaveLength(0);
  }, 60_000);
});
