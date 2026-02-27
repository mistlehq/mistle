import type {
  StartSandboxInstanceInput,
  StartSandboxInstanceAcceptedResponse,
} from "@mistle/data-plane-trpc/contracts";

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { describe, expect } from "vitest";

import type { DataPlaneTrpcRouter } from "../src/trpc/router.js";

import { it } from "./test-context.js";

type WorkflowRunRow = {
  id: string;
  namespace_id: string;
  workflow_name: string;
  status: string;
  input: StartSandboxInstanceInput;
};

function createTrpcClient(
  baseUrl: string,
): ReturnType<typeof createTRPCClient<DataPlaneTrpcRouter>> {
  return createTRPCClient<DataPlaneTrpcRouter>({
    links: [
      httpBatchLink({
        url: new URL("/trpc", baseUrl).toString(),
      }),
    ],
  });
}

describe("sandboxInstances.start integration", () => {
  it("enqueues a start-sandbox workflow run and returns accepted response", async ({ fixture }) => {
    const client = createTrpcClient(fixture.baseUrl);
    const workflowInput: StartSandboxInstanceInput = {
      organizationId: "org_dp_api_integration_001",
      sandboxProfileId: "sbp_dp_api_integration_001",
      sandboxProfileVersion: 7,
      manifest: {
        app: "demo",
        version: "v1",
      },
      startedBy: {
        kind: "user",
        id: "usr_dp_api_integration_001",
      },
      source: "dashboard",
      image: {
        provider: "modal",
        imageId: "im_dp_api_integration_001",
        kind: "base",
        createdAt: "2026-02-27T00:00:00.000Z",
      },
    };

    const response: StartSandboxInstanceAcceptedResponse =
      await client.sandboxInstances.start.mutate(workflowInput);

    expect(response.status).toBe("accepted");
    expect(response.workflowRunId).not.toBe("");

    const workflowRowsResult = await fixture.dbPool.query<WorkflowRunRow>(
      `
        select id, namespace_id, workflow_name, status, input
        from data_plane_openworkflow.workflow_runs
        where namespace_id = $1 and id = $2
      `,
      [fixture.config.workflow.namespaceId, response.workflowRunId],
    );

    expect(workflowRowsResult.rows).toHaveLength(1);

    const workflowRun = workflowRowsResult.rows[0];
    if (workflowRun === undefined) {
      throw new Error("Expected queued workflow run row to exist.");
    }

    expect(workflowRun.namespace_id).toBe(fixture.config.workflow.namespaceId);
    expect(workflowRun.workflow_name).toBe("data-plane.sandbox-instances.start");
    expect(workflowRun.status).toBe("pending");
    expect(workflowRun.input).toEqual(workflowInput);
  }, 60_000);
});
