import { DATA_PLANE_INTERNAL_AUTH_HEADER } from "@mistle/data-plane-trpc/constants";
import type {
  StartSandboxInstanceCompletedResponse,
  StartSandboxInstanceInput,
} from "@mistle/data-plane-trpc/contracts";
import type { DataPlaneTrpcRouter } from "@mistle/data-plane-trpc/router";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { describe, expect } from "vitest";

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

const ForbiddenProfileIdForRuntimePlanInsertFailure = "sbp_dp_api_runtime_plan_insert_failure";
const RuntimePlanInsertFailureConstraint = "sandbox_instance_runtime_plans_forbidden_profile_check";

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

    const persistedRuntimePlan = await fixture.db.query.sandboxInstanceRuntimePlans.findFirst({
      columns: {
        sandboxInstanceId: true,
        revision: true,
        compiledFromProfileId: true,
        compiledFromProfileVersion: true,
      },
      where: (table, { and, eq, isNull }) =>
        and(
          eq(table.sandboxInstanceId, response.sandboxInstanceId),
          eq(table.revision, 1),
          isNull(table.supersededAt),
        ),
    });
    if (persistedRuntimePlan === undefined) {
      throw new Error("Expected persisted sandbox instance runtime plan row to exist.");
    }
    expect(persistedRuntimePlan.compiledFromProfileId).toBe(sandboxProfileId);
    expect(persistedRuntimePlan.compiledFromProfileVersion).toBe(7);
  }, 60_000);

  it("deduplicates duplicate start requests via idempotency key", async ({ fixture }) => {
    const client = createTrpcClient(fixture.baseUrl, fixture.internalAuthServiceToken);
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

  it("rolls back sandbox instance insert when runtime plan insert fails", async ({ fixture }) => {
    const client = createTrpcClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const organizationId = "org_dp_api_runtime_plan_insert_failure";

    await fixture.dbPool.query(`
      alter table data_plane.sandbox_instance_runtime_plans
      add constraint ${RuntimePlanInsertFailureConstraint}
      check (compiled_from_profile_id <> '${ForbiddenProfileIdForRuntimePlanInsertFailure}')
    `);

    try {
      await expect(
        client.sandboxInstances.start.mutate({
          organizationId,
          sandboxProfileId: ForbiddenProfileIdForRuntimePlanInsertFailure,
          sandboxProfileVersion: 1,
          runtimePlan: createRuntimePlan({
            sandboxProfileId: ForbiddenProfileIdForRuntimePlanInsertFailure,
            version: 1,
          }),
          startedBy: {
            kind: "user",
            id: "usr_dp_api_runtime_plan_insert_failure",
          },
          source: "dashboard",
          image: {
            imageId: "im_dp_api_runtime_plan_insert_failure",
            kind: "base",
            createdAt: "2026-02-27T00:00:00.000Z",
          },
        }),
      ).rejects.toThrow(
        "Failed to persist sandbox instance after provider sandbox start. Provider sandbox was stopped.",
      );

      const persistedSandboxInstances = await fixture.db.query.sandboxInstances.findMany({
        columns: {
          id: true,
        },
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, organizationId),
            eq(table.sandboxProfileId, ForbiddenProfileIdForRuntimePlanInsertFailure),
          ),
      });
      expect(persistedSandboxInstances).toHaveLength(0);

      const persistedRuntimePlans = await fixture.db.query.sandboxInstanceRuntimePlans.findMany({
        columns: {
          id: true,
        },
        where: (table, { eq }) =>
          eq(table.compiledFromProfileId, ForbiddenProfileIdForRuntimePlanInsertFailure),
      });
      expect(persistedRuntimePlans).toHaveLength(0);
    } finally {
      await fixture.dbPool.query(`
        alter table data_plane.sandbox_instance_runtime_plans
        drop constraint if exists ${RuntimePlanInsertFailureConstraint}
      `);
    }
  }, 60_000);
});
