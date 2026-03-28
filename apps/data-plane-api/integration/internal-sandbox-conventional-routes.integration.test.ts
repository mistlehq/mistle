import { DATA_PLANE_INTERNAL_AUTH_HEADER } from "@mistle/data-plane-internal-client";
import {
  sandboxInstanceRuntimePlans,
  sandboxInstances,
  SandboxInstanceStatuses,
} from "@mistle/db/data-plane";
import { systemSleeper } from "@mistle/time";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";
import { z } from "zod";

import { INTERNAL_SANDBOX_ROUTE_BASE_PATH } from "../src/internal/index.js";
import { it, type DataPlaneApiIntegrationFixture } from "./test-context.js";

type WorkflowRunRow = {
  id: string;
  namespace_id: string;
  workflow_name: string;
  status: string;
  input: unknown;
  output: null;
};

const WorkflowQueuePollIntervalMs = 100;
const WorkflowQueueWaitTimeoutMs = 10_000;

const ResumeWorkflowInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
  })
  .loose();

const StopWorkflowInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    stopReason: z.union([z.literal("idle"), z.literal("disconnected")]),
    expectedOwnerLeaseId: z.string().min(1),
  })
  .strict();

const ReconcileWorkflowInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    reason: z.literal("disconnect_grace_elapsed"),
    expectedOwnerLeaseId: z.string().min(1),
  })
  .strict();

function createRuntimePlan(input: { sandboxProfileId: string; version: number }) {
  return {
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    image: {
      source: "base" as const,
      imageRef: "registry:3",
    },
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: [],
    agentRuntimes: [],
  };
}

async function waitForWorkflowRun(input: {
  fixture: DataPlaneApiIntegrationFixture;
  workflowName: string;
  sandboxInstanceId: string;
  namespaceId: string;
}): Promise<WorkflowRunRow> {
  const deadlineMs = Date.now() + WorkflowQueueWaitTimeoutMs;

  while (Date.now() < deadlineMs) {
    const result = await input.fixture.dbPool.query<WorkflowRunRow>(
      `
        select id, namespace_id, workflow_name, status, input, output
        from data_plane_openworkflow.workflow_runs
        where
          namespace_id = $1
          and workflow_name = $2
          and input->>'sandboxInstanceId' = $3
        order by created_at asc
      `,
      [input.namespaceId, input.workflowName, input.sandboxInstanceId],
    );

    const workflowRun = result.rows[0];
    if (workflowRun !== undefined) {
      return workflowRun;
    }

    await systemSleeper.sleep(WorkflowQueuePollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for workflow '${input.workflowName}' for sandbox '${input.sandboxInstanceId}'.`,
  );
}

describe("internal sandbox conventional routes integration", () => {
  it("starts a sandbox instance from POST /internal/sandbox/instances", async ({ fixture }) => {
    const response = await fetch(
      new URL(`${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances`, fixture.baseUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId: "org_dp_api_conventional_start",
          sandboxProfileId: "sbp_dp_api_conventional_start",
          sandboxProfileVersion: 3,
          runtimePlan: createRuntimePlan({
            sandboxProfileId: "sbp_dp_api_conventional_start",
            version: 3,
          }),
          startedBy: {
            kind: "user",
            id: "usr_dp_api_conventional_start",
          },
          source: "dashboard",
          image: {
            imageId: "im_dp_api_conventional_start",
            createdAt: "2026-03-27T00:00:00.000Z",
          },
        }),
      },
    );

    expect(response.status).toBe(200);

    const startedSandbox = await response.json();
    const parsedResponse = z
      .object({
        status: z.literal("accepted"),
        sandboxInstanceId: z.string().min(1),
        workflowRunId: z.string().min(1),
      })
      .strict()
      .parse(startedSandbox);

    const insertedInstance = await fixture.db.query.sandboxInstances.findFirst({
      columns: {
        id: true,
        status: true,
      },
      where: (table, { eq }) => eq(table.id, parsedResponse.sandboxInstanceId),
    });

    expect(insertedInstance).toEqual({
      id: parsedResponse.sandboxInstanceId,
      status: SandboxInstanceStatuses.PENDING,
    });
  }, 60_000);

  it("lists sandbox instances from GET /internal/sandbox/instances", async ({ fixture }) => {
    await fixture.db.insert(sandboxInstances).values([
      {
        id: "sbi_conventional_list_001",
        organizationId: "org_dp_api_conventional_list",
        sandboxProfileId: "sbp_conventional_list",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-conventional-list-001",
        status: SandboxInstanceStatuses.STOPPED,
        startedByKind: "user",
        startedById: "usr_conventional_list",
        source: "dashboard",
        createdAt: "2026-03-27T00:00:02.000Z",
        updatedAt: "2026-03-27T00:00:02.000Z",
      },
      {
        id: "sbi_conventional_list_002",
        organizationId: "org_dp_api_conventional_list",
        sandboxProfileId: "sbp_conventional_list",
        sandboxProfileVersion: 2,
        runtimeProvider: "docker",
        providerSandboxId: "provider-conventional-list-002",
        status: SandboxInstanceStatuses.FAILED,
        startedByKind: "system",
        startedById: "sys_conventional_list",
        source: "webhook",
        failureCode: "SANDBOX_START_FAILED",
        failureMessage: "Sandbox failed to start.",
        createdAt: "2026-03-27T00:00:03.000Z",
        updatedAt: "2026-03-27T00:00:04.000Z",
      },
    ]);

    const response = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances?organizationId=org_dp_api_conventional_list&limit=2`,
        fixture.baseUrl,
      ),
      {
        headers: {
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      totalResults: 2,
      items: [
        {
          id: "sbi_conventional_list_002",
          status: "failed",
        },
        {
          id: "sbi_conventional_list_001",
          status: "stopped",
        },
      ],
    });
  }, 60_000);

  it("queues resume and stop workflows from the new member routes", async ({ fixture }) => {
    const sandboxInstanceId = "sbi_conventional_resume_stop";

    await fixture.db.insert(sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: "org_dp_api_conventional_resume_stop",
      sandboxProfileId: "sbp_conventional_resume_stop",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-conventional-resume-stop",
      status: SandboxInstanceStatuses.STOPPED,
      startedByKind: "user",
      startedById: "usr_conventional_resume_stop",
      source: "dashboard",
    });
    await fixture.db.insert(sandboxInstanceRuntimePlans).values({
      sandboxInstanceId,
      revision: 1,
      compiledRuntimePlan: createRuntimePlan({
        sandboxProfileId: "sbp_conventional_resume_stop",
        version: 1,
      }),
      compiledFromProfileId: "sbp_conventional_resume_stop",
      compiledFromProfileVersion: 1,
    });

    const resumeResponse = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/${sandboxInstanceId}/resume`,
        fixture.baseUrl,
      ),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId: "org_dp_api_conventional_resume_stop",
        }),
      },
    );

    expect(resumeResponse.status).toBe(200);
    const parsedResumeResponse = z
      .object({
        status: z.literal("accepted"),
        sandboxInstanceId: z.string().min(1),
        workflowRunId: z.string().min(1),
      })
      .strict()
      .parse(await resumeResponse.json());
    expect(parsedResumeResponse.sandboxInstanceId).toBe(sandboxInstanceId);

    const resumeWorkflowRun = await waitForWorkflowRun({
      fixture,
      namespaceId: fixture.config.workflow.namespaceId,
      workflowName: "data-plane.sandbox-instances.resume",
      sandboxInstanceId,
    });
    expect(ResumeWorkflowInputSchema.parse(resumeWorkflowRun.input)).toEqual({
      sandboxInstanceId,
    });

    await fixture.db
      .update(sandboxInstances)
      .set({
        status: SandboxInstanceStatuses.RUNNING,
      })
      .where(eq(sandboxInstances.id, sandboxInstanceId));

    const stopResponse = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/${sandboxInstanceId}/stop`,
        fixture.baseUrl,
      ),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          stopReason: "idle",
          expectedOwnerLeaseId: "sol_conventional_stop",
          idempotencyKey: "gateway-stop-conventional",
        }),
      },
    );

    expect(stopResponse.status).toBe(200);
    const parsedStopResponse = z
      .object({
        status: z.literal("accepted"),
        sandboxInstanceId: z.string().min(1),
        workflowRunId: z.string().min(1),
      })
      .strict()
      .parse(await stopResponse.json());
    expect(parsedStopResponse.sandboxInstanceId).toBe(sandboxInstanceId);

    const stopWorkflowRun = await waitForWorkflowRun({
      fixture,
      namespaceId: fixture.config.workflow.namespaceId,
      workflowName: "data-plane.sandbox-instances.stop",
      sandboxInstanceId,
    });
    expect(StopWorkflowInputSchema.parse(stopWorkflowRun.input)).toEqual({
      sandboxInstanceId,
      stopReason: "idle",
      expectedOwnerLeaseId: "sol_conventional_stop",
    });
  }, 60_000);

  it("queues the reconcile workflow from the new member route", async ({ fixture }) => {
    const sandboxInstanceId = "sbi_conventional_reconcile";

    await fixture.db.insert(sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: "org_dp_api_conventional_reconcile",
      sandboxProfileId: "sbp_conventional_reconcile",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-conventional-reconcile",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: "usr_conventional_reconcile",
      source: "dashboard",
    });

    const reconcileResponse = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/${sandboxInstanceId}/reconcile`,
        fixture.baseUrl,
      ),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          reason: "disconnect_grace_elapsed",
          expectedOwnerLeaseId: "sol_conventional_reconcile",
          idempotencyKey: "gateway-reconcile-conventional",
        }),
      },
    );

    expect(reconcileResponse.status).toBe(200);
    const parsedReconcileResponse = z
      .object({
        status: z.literal("accepted"),
        sandboxInstanceId: z.string().min(1),
        workflowRunId: z.string().min(1),
      })
      .strict()
      .parse(await reconcileResponse.json());
    expect(parsedReconcileResponse.sandboxInstanceId).toBe(sandboxInstanceId);

    const reconcileWorkflowRun = await waitForWorkflowRun({
      fixture,
      namespaceId: fixture.config.workflow.namespaceId,
      workflowName: "data-plane.sandbox-instances.reconcile",
      sandboxInstanceId,
    });
    expect(ReconcileWorkflowInputSchema.parse(reconcileWorkflowRun.input)).toEqual({
      sandboxInstanceId,
      reason: "disconnect_grace_elapsed",
      expectedOwnerLeaseId: "sol_conventional_reconcile",
    });
  }, 60_000);

  it("rejects unauthorized requests on the new route base", async ({ fixture }) => {
    const response = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances?organizationId=org_dp_api_conventional_unauthorized`,
        fixture.baseUrl,
      ),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  }, 60_000);
});
