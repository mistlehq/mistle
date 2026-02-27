import { DATA_PLANE_INTERNAL_AUTH_HEADER } from "@mistle/data-plane-trpc/constants";
import type {
  StartSandboxInstanceCompletedResponse,
  StartSandboxInstanceInput,
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
  output: {
    sandboxInstanceId: string;
    providerSandboxId: string;
  } | null;
};

function createTrpcClient(
  baseUrl: string,
  serviceToken: string,
): ReturnType<typeof createTRPCClient<DataPlaneTrpcRouter>> {
  return createTRPCClient<DataPlaneTrpcRouter>({
    links: [
      httpBatchLink({
        url: new URL("/trpc", baseUrl).toString(),
        headers: {
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: serviceToken,
        },
      }),
    ],
  });
}

describe("sandboxInstances.start integration", () => {
  it("waits for workflow completion and returns completed response", async ({ fixture }) => {
    const client = createTrpcClient(fixture.baseUrl, fixture.internalAuthServiceToken);
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

    const response: StartSandboxInstanceCompletedResponse =
      await client.sandboxInstances.start.mutate(workflowInput);

    expect(response.status).toBe("completed");
    expect(response.workflowRunId).not.toBe("");
    expect(response.sandboxInstanceId).not.toBe("");
    expect(response.providerSandboxId).not.toBe("");

    const workflowRowsResult = await fixture.dbPool.query<WorkflowRunRow>(
      `
        select id, namespace_id, workflow_name, status, input, output
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
    expect(workflowRun.status).toBe("completed");
    expect(workflowRun.input).toEqual(workflowInput);
    expect(workflowRun.output).toEqual({
      sandboxInstanceId: response.sandboxInstanceId,
      providerSandboxId: response.providerSandboxId,
    });

    const persistedSandboxInstance = await fixture.db.query.sandboxInstances.findFirst({
      columns: {
        id: true,
        providerSandboxId: true,
      },
      where: (table, { eq }) => eq(table.id, response.sandboxInstanceId),
    });
    if (persistedSandboxInstance === undefined) {
      throw new Error("Expected persisted sandbox instance row to exist.");
    }
    expect(persistedSandboxInstance.providerSandboxId).toBe(response.providerSandboxId);
  }, 60_000);

  it("deduplicates duplicate start requests via idempotency key", async ({ fixture }) => {
    const client = createTrpcClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const workflowInput: StartSandboxInstanceInput = {
      organizationId: "org_dp_api_integration_idempotent",
      sandboxProfileId: "sbp_dp_api_integration_idempotent",
      sandboxProfileVersion: 11,
      manifest: {
        app: "demo-idempotent",
      },
      startedBy: {
        kind: "user",
        id: "usr_dp_api_integration_idempotent",
      },
      source: "dashboard",
      image: {
        provider: "modal",
        imageId: "im_dp_api_integration_idempotent",
        kind: "base",
        createdAt: "2026-02-27T00:00:00.000Z",
      },
    };

    const firstResponse: StartSandboxInstanceCompletedResponse =
      await client.sandboxInstances.start.mutate(workflowInput);
    const secondResponse: StartSandboxInstanceCompletedResponse =
      await client.sandboxInstances.start.mutate(workflowInput);

    expect(secondResponse).toEqual(firstResponse);

    const persistedSandboxInstances = await fixture.db.query.sandboxInstances.findMany({
      columns: {
        id: true,
      },
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, workflowInput.organizationId),
          eq(table.sandboxProfileId, workflowInput.sandboxProfileId),
          eq(table.sandboxProfileVersion, workflowInput.sandboxProfileVersion),
          eq(table.startedByKind, workflowInput.startedBy.kind),
          eq(table.startedById, workflowInput.startedBy.id),
          eq(table.source, workflowInput.source),
        ),
    });
    expect(persistedSandboxInstances).toHaveLength(1);
  }, 60_000);

  it("rejects requests missing service token", async ({ fixture }) => {
    const client = createTRPCClient<DataPlaneTrpcRouter>({
      links: [
        httpBatchLink({
          url: new URL("/trpc", fixture.baseUrl).toString(),
        }),
      ],
    });

    await expect(
      client.sandboxInstances.start.mutate({
        organizationId: "org_dp_api_integration_unauth_missing",
        sandboxProfileId: "sbp_dp_api_integration_unauth_missing",
        sandboxProfileVersion: 1,
        manifest: {
          app: "demo",
        },
        startedBy: {
          kind: "user",
          id: "usr_dp_api_integration_unauth_missing",
        },
        source: "dashboard",
        image: {
          provider: "modal",
          imageId: "im_dp_api_integration_unauth_missing",
          kind: "base",
          createdAt: "2026-02-27T00:00:00.000Z",
        },
      }),
    ).rejects.toThrow("Internal service authentication failed.");
  }, 60_000);

  it("rejects requests with invalid service token", async ({ fixture }) => {
    const client = createTrpcClient(fixture.baseUrl, "invalid-service-token");

    await expect(
      client.sandboxInstances.start.mutate({
        organizationId: "org_dp_api_integration_unauth_invalid",
        sandboxProfileId: "sbp_dp_api_integration_unauth_invalid",
        sandboxProfileVersion: 1,
        manifest: {
          app: "demo",
        },
        startedBy: {
          kind: "user",
          id: "usr_dp_api_integration_unauth_invalid",
        },
        source: "dashboard",
        image: {
          provider: "modal",
          imageId: "im_dp_api_integration_unauth_invalid",
          kind: "base",
          createdAt: "2026-02-27T00:00:00.000Z",
        },
      }),
    ).rejects.toThrow("Internal service authentication failed.");
  }, 60_000);
});
