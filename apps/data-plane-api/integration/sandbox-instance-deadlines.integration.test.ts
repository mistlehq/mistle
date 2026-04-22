import {
  sandboxInstanceDeadlines,
  sandboxInstances,
  SandboxInstanceDeadlineKinds,
  SandboxInstanceStatuses,
} from "@mistle/db/data-plane";
import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";
import { z } from "zod";

import {
  DATA_PLANE_INTERNAL_AUTH_HEADER,
  type DeleteSandboxInstanceDeadlineInput,
  type PutSandboxInstanceDeadlineInput,
} from "../../../packages/data-plane-internal-client/src/index.js";
import { createDataPlaneSandboxInstancesClient } from "../../../packages/data-plane-internal-client/src/index.js";
import { INTERNAL_SANDBOX_ROUTE_BASE_PATH } from "../src/internal/index.js";
import {
  createSandboxInstanceDeadlineAdvisoryLockResourceKey,
  SandboxInstanceDeadlineAdvisoryLockNamespace,
} from "../src/internal/sandbox-instances/services/put-sandbox-instance-deadline.js";
import { it, type DataPlaneApiIntegrationFixture } from "./test-context.js";

type WorkflowRunRow = {
  id: string;
  namespace_id: string;
  workflow_name: string;
  status: string;
  input: unknown;
  output: null;
  idempotency_key: string | null;
  available_at: string;
};

const WorkflowName = "data-plane.sandbox-instance-deadlines.handle";
const WorkflowQueuePollIntervalMs = 100;
const WorkflowQueueWaitTimeoutMs = 10_000;
const CanonicalDueAt = "2026-04-15T12:00:00.000Z";
const AlternateCanonicalDueAt = "2026-04-15T12:05:00.000Z";

const WorkflowRunInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    kind: z.enum(["idle", "disconnect"]),
    ownerLeaseId: z.string().min(1),
    dueAt: z.string().min(1),
    generation: z.number().int().min(1),
  })
  .strict();

function createSandboxInstancesClient(
  baseUrl: string,
  serviceToken: string,
  requestTimeoutMs?: number,
): ReturnType<typeof createDataPlaneSandboxInstancesClient> {
  return createDataPlaneSandboxInstancesClient({
    baseUrl,
    serviceToken,
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
  });
}

function createDeadlineRouteUrl(input: {
  baseUrl: string;
  sandboxInstanceId: string;
  kind: "idle" | "disconnect";
}): URL {
  return new URL(
    `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/${encodeURIComponent(input.sandboxInstanceId)}/deadlines/${encodeURIComponent(input.kind)}`,
    input.baseUrl,
  );
}

function createExpectedDeadlineIdempotencyKey(input: {
  sandboxInstanceId: string;
  kind: "idle" | "disconnect";
  ownerLeaseId: string;
  dueAt: string;
  generation: number;
}): string {
  return `deadline:${input.sandboxInstanceId}:${input.kind}:${input.ownerLeaseId}:${input.dueAt}:${String(input.generation)}`;
}

function canonicalizePersistedDueAt(dueAt: string): string {
  return new Date(dueAt).toISOString();
}

async function waitForWorkflowRuns(input: {
  fixture: DataPlaneApiIntegrationFixture;
  sandboxInstanceId: string;
  minimumCount?: number;
}): Promise<WorkflowRunRow[]> {
  const deadlineMs = Date.now() + WorkflowQueueWaitTimeoutMs;
  const minimumCount = input.minimumCount ?? 1;

  while (Date.now() < deadlineMs) {
    const workflowRuns = await listWorkflowRuns(input);
    if (workflowRuns.length >= minimumCount) {
      return workflowRuns;
    }

    await systemSleeper.sleep(WorkflowQueuePollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued deadline workflow runs for sandbox '${input.sandboxInstanceId}'.`,
  );
}

async function listWorkflowRuns(input: {
  fixture: DataPlaneApiIntegrationFixture;
  sandboxInstanceId: string;
}): Promise<WorkflowRunRow[]> {
  const result = await input.fixture.dbPool.query<WorkflowRunRow>(
    `
      select id, namespace_id, workflow_name, status, input, output, idempotency_key, available_at
      from data_plane_openworkflow.workflow_runs
      where
        namespace_id = $1
        and workflow_name = $2
        and input->>'sandboxInstanceId' = $3
      order by created_at asc
    `,
    [input.fixture.config.workflow.namespaceId, WorkflowName, input.sandboxInstanceId],
  );

  return result.rows;
}

async function waitForPendingDeadlineWriteLockWaiters(input: {
  fixture: DataPlaneApiIntegrationFixture;
  sandboxInstanceId: string;
  kind: "idle" | "disconnect";
  minimumCount?: number;
}): Promise<void> {
  const deadlineMs = Date.now() + WorkflowQueueWaitTimeoutMs;
  const minimumCount = input.minimumCount ?? 1;
  const resourceKey = createSandboxInstanceDeadlineAdvisoryLockResourceKey({
    sandboxInstanceId: input.sandboxInstanceId,
    kind: input.kind,
  });

  while (Date.now() < deadlineMs) {
    const result = await input.fixture.dbPool.query<{ waiters: number }>(
      `
        select count(*)::int as waiters
        from pg_locks
        where
          locktype = 'advisory'
          and classid = $1
          and objid = hashtext($2)
          and objsubid = 2
          and granted = false
      `,
      [SandboxInstanceDeadlineAdvisoryLockNamespace, resourceKey],
    );

    if ((result.rows[0]?.waiters ?? 0) >= minimumCount) {
      return;
    }

    await systemSleeper.sleep(WorkflowQueuePollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for ${String(minimumCount)} pending deadline lock waiter(s) for sandbox '${input.sandboxInstanceId}' and kind '${input.kind}'.`,
  );
}

describe("sandbox instance deadlines integration", () => {
  it("creates, schedules, and clears sandbox instance deadlines through the internal client", async ({
    fixture,
  }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const sandboxInstanceId = "sbi_dp_api_deadline_put_delete";
    const putInput: PutSandboxInstanceDeadlineInput = {
      sandboxInstanceId,
      kind: "idle",
      ownerLeaseId: "sol_dp_api_deadline_put_delete",
      dueAt: CanonicalDueAt,
    };
    const deleteInput: DeleteSandboxInstanceDeadlineInput = {
      sandboxInstanceId,
      kind: "idle",
    };

    await fixture.db.insert(sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: "org_dp_api_deadline_put_delete",
      sandboxProfileId: "sbp_dp_api_deadline_put_delete",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-deadline-put-delete",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: "usr_dp_api_deadline_put_delete",
      source: "dashboard",
    });

    const putResponse = await client.putSandboxInstanceDeadline(putInput);

    expect(putResponse).toEqual({
      status: "accepted",
      sandboxInstanceId,
      kind: "idle",
      generation: 1,
      workflowRunId: putResponse.workflowRunId,
    });

    const workflowRuns = await waitForWorkflowRuns({
      fixture,
      sandboxInstanceId,
    });
    expect(workflowRuns).toHaveLength(1);
    expect(workflowRuns[0]).toMatchObject({
      id: putResponse.workflowRunId,
      namespace_id: fixture.config.workflow.namespaceId,
      workflow_name: WorkflowName,
      status: "pending",
      output: null,
      idempotency_key: createExpectedDeadlineIdempotencyKey({
        sandboxInstanceId,
        kind: putInput.kind,
        ownerLeaseId: putInput.ownerLeaseId,
        dueAt: putInput.dueAt,
        generation: 1,
      }),
    });
    expect(WorkflowRunInputSchema.parse(workflowRuns[0]?.input)).toEqual({
      sandboxInstanceId,
      kind: putInput.kind,
      ownerLeaseId: putInput.ownerLeaseId,
      dueAt: putInput.dueAt,
      generation: 1,
    });
    expect(canonicalizePersistedDueAt(workflowRuns[0]?.available_at ?? "")).toBe(CanonicalDueAt);

    const persistedDeadline = await fixture.db.query.sandboxInstanceDeadlines.findFirst({
      columns: {
        kind: true,
        ownerLeaseId: true,
        dueAt: true,
        generation: true,
        clearedAt: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxInstanceId, sandboxInstanceId), eq(table.kind, putInput.kind)),
    });

    expect(persistedDeadline).toEqual({
      kind: putInput.kind,
      ownerLeaseId: putInput.ownerLeaseId,
      dueAt: expect.any(String),
      generation: 1,
      clearedAt: null,
    });
    expect(canonicalizePersistedDueAt(persistedDeadline?.dueAt ?? "")).toBe(CanonicalDueAt);

    const deleteResponse = await client.deleteSandboxInstanceDeadline(deleteInput);

    expect(deleteResponse).toEqual({
      status: "ok",
      sandboxInstanceId,
      kind: deleteInput.kind,
    });

    const clearedDeadline = await fixture.db.query.sandboxInstanceDeadlines.findFirst({
      columns: {
        clearedAt: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxInstanceId, sandboxInstanceId), eq(table.kind, deleteInput.kind)),
    });

    expect(clearedDeadline?.clearedAt).toEqual(expect.any(String));
  }, 60_000);

  it("bumps generation after a cleared deadline is reactivated", async ({ fixture }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const sandboxInstanceId = "sbi_dp_api_deadline_reactivate";

    await fixture.db.insert(sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: "org_dp_api_deadline_reactivate",
      sandboxProfileId: "sbp_dp_api_deadline_reactivate",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-deadline-reactivate",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: "usr_dp_api_deadline_reactivate",
      source: "dashboard",
    });

    const initialResponse = await client.putSandboxInstanceDeadline({
      sandboxInstanceId,
      kind: "disconnect",
      ownerLeaseId: "sol_dp_api_deadline_reactivate",
      dueAt: CanonicalDueAt,
    });
    expect(initialResponse.generation).toBe(1);

    const clearedResponse = await client.deleteSandboxInstanceDeadline({
      sandboxInstanceId,
      kind: "disconnect",
    });
    expect(clearedResponse.status).toBe("ok");

    const reactivatedResponse = await client.putSandboxInstanceDeadline({
      sandboxInstanceId,
      kind: "disconnect",
      ownerLeaseId: "sol_dp_api_deadline_reactivate",
      dueAt: CanonicalDueAt,
    });

    expect(reactivatedResponse.generation).toBe(2);

    const persistedDeadline = await fixture.db.query.sandboxInstanceDeadlines.findFirst({
      columns: {
        generation: true,
        clearedAt: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxInstanceId, sandboxInstanceId), eq(table.kind, "disconnect")),
    });

    expect(persistedDeadline).toEqual({
      generation: 2,
      clearedAt: null,
    });
  }, 60_000);

  it("returns idempotent ok when deleting a missing or already-cleared deadline", async ({
    fixture,
  }) => {
    const client = createSandboxInstancesClient(fixture.baseUrl, fixture.internalAuthServiceToken);
    const missingSandboxInstanceId = "sbi_dp_api_deadline_delete_missing";

    await expect(
      client.deleteSandboxInstanceDeadline({
        sandboxInstanceId: missingSandboxInstanceId,
        kind: "idle",
      }),
    ).resolves.toEqual({
      status: "ok",
      sandboxInstanceId: missingSandboxInstanceId,
      kind: "idle",
    });

    const sandboxInstanceId = "sbi_dp_api_deadline_delete_cleared";
    await fixture.db.insert(sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: "org_dp_api_deadline_delete_cleared",
      sandboxProfileId: "sbp_dp_api_deadline_delete_cleared",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-deadline-delete-cleared",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: "usr_dp_api_deadline_delete_cleared",
      source: "dashboard",
    });
    await fixture.db.insert(sandboxInstanceDeadlines).values({
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      ownerLeaseId: "sol_dp_api_deadline_delete_cleared",
      dueAt: CanonicalDueAt,
      clearedAt: CanonicalDueAt,
    });

    await expect(
      client.deleteSandboxInstanceDeadline({
        sandboxInstanceId,
        kind: "idle",
      }),
    ).resolves.toEqual({
      status: "ok",
      sandboxInstanceId,
      kind: "idle",
    });
  }, 60_000);

  it("does not schedule the workflow when persisting the deadline row fails", async ({
    fixture,
  }) => {
    const sandboxInstanceId = "sbi_dp_api_deadline_schedule_first";
    const response = await fetch(
      createDeadlineRouteUrl({
        baseUrl: fixture.baseUrl,
        sandboxInstanceId,
        kind: "idle",
      }),
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          ownerLeaseId: "sol_dp_api_deadline_schedule_first",
          dueAt: CanonicalDueAt,
        }),
      },
    );

    expect(response.status).toBe(500);

    const workflowRuns = await listWorkflowRuns({
      fixture,
      sandboxInstanceId,
    });
    expect(workflowRuns).toHaveLength(0);

    const persistedDeadline = await fixture.db.query.sandboxInstanceDeadlines.findFirst({
      columns: {
        sandboxInstanceId: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxInstanceId, sandboxInstanceId), eq(table.kind, "idle")),
    });

    expect(persistedDeadline).toBeUndefined();
  }, 60_000);

  it("rejects non-canonical dueAt values with validation errors", async ({ fixture }) => {
    await fixture.db.insert(sandboxInstances).values({
      id: "sbi_dp_api_deadline_invalid_due_at",
      organizationId: "org_dp_api_deadline_invalid_due_at",
      sandboxProfileId: "sbp_dp_api_deadline_invalid_due_at",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-deadline-invalid-due-at",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: "usr_dp_api_deadline_invalid_due_at",
      source: "dashboard",
    });

    const response = await fetch(
      createDeadlineRouteUrl({
        baseUrl: fixture.baseUrl,
        sandboxInstanceId: "sbi_dp_api_deadline_invalid_due_at",
        kind: "idle",
      }),
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          ownerLeaseId: "sol_dp_api_deadline_invalid_due_at",
          dueAt: "2026-04-15T12:00:00Z",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  }, 60_000);

  it("applies last-write-wins semantics for concurrent deadline puts", async ({ fixture }) => {
    const client = createSandboxInstancesClient(
      fixture.baseUrl,
      fixture.internalAuthServiceToken,
      15_000,
    );
    const sandboxInstanceId = "sbi_dp_api_deadline_concurrent_put";
    const firstInput: PutSandboxInstanceDeadlineInput = {
      sandboxInstanceId,
      kind: "disconnect",
      ownerLeaseId: "sol_dp_api_deadline_concurrent_put_first",
      dueAt: CanonicalDueAt,
    };
    const secondInput: PutSandboxInstanceDeadlineInput = {
      sandboxInstanceId,
      kind: "disconnect",
      ownerLeaseId: "sol_dp_api_deadline_concurrent_put_second",
      dueAt: AlternateCanonicalDueAt,
    };

    await fixture.db.insert(sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: "org_dp_api_deadline_concurrent_put",
      sandboxProfileId: "sbp_dp_api_deadline_concurrent_put",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-deadline-concurrent-put",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: "usr_dp_api_deadline_concurrent_put",
      source: "dashboard",
    });

    const lockClient = await fixture.dbPool.connect();
    try {
      await lockClient.query("BEGIN");
      await lockClient.query(
        `
          select pg_advisory_xact_lock($1, hashtext($2))
        `,
        [
          SandboxInstanceDeadlineAdvisoryLockNamespace,
          createSandboxInstanceDeadlineAdvisoryLockResourceKey({
            sandboxInstanceId,
            kind: "disconnect",
          }),
        ],
      );

      const firstRequestPromise = client.putSandboxInstanceDeadline(firstInput);
      await waitForPendingDeadlineWriteLockWaiters({
        fixture,
        sandboxInstanceId,
        kind: "disconnect",
      });

      const secondRequestPromise = client.putSandboxInstanceDeadline(secondInput);
      await waitForPendingDeadlineWriteLockWaiters({
        fixture,
        sandboxInstanceId,
        minimumCount: 2,
        kind: "disconnect",
      });

      await lockClient.query("COMMIT");

      const [firstResponse, secondResponse] = await Promise.all([
        firstRequestPromise,
        secondRequestPromise,
      ]);

      expect(firstResponse.status).toBe("accepted");
      expect(secondResponse.status).toBe("accepted");

      const workflowRuns = await waitForWorkflowRuns({
        fixture,
        sandboxInstanceId,
        minimumCount: 2,
      });
      expect(workflowRuns).toHaveLength(2);

      const parsedInputs = workflowRuns.map((run) => WorkflowRunInputSchema.parse(run.input));
      expect(parsedInputs).toEqual(
        expect.arrayContaining([
          {
            sandboxInstanceId,
            kind: "disconnect",
            ownerLeaseId: firstInput.ownerLeaseId,
            dueAt: firstInput.dueAt,
            generation: 1,
          },
          {
            sandboxInstanceId,
            kind: "disconnect",
            ownerLeaseId: secondInput.ownerLeaseId,
            dueAt: secondInput.dueAt,
            generation: 2,
          },
        ]),
      );

      const persistedDeadline = await fixture.db.query.sandboxInstanceDeadlines.findFirst({
        columns: {
          ownerLeaseId: true,
          dueAt: true,
          generation: true,
          clearedAt: true,
        },
        where: (table, { and, eq }) =>
          and(eq(table.sandboxInstanceId, sandboxInstanceId), eq(table.kind, "disconnect")),
      });

      expect(persistedDeadline).toEqual({
        ownerLeaseId: secondInput.ownerLeaseId,
        dueAt: expect.any(String),
        generation: 2,
        clearedAt: null,
      });
      expect(canonicalizePersistedDueAt(persistedDeadline?.dueAt ?? "")).toBe(secondInput.dueAt);
    } finally {
      try {
        await lockClient.query("ROLLBACK");
      } catch {}
      lockClient.release();
    }
  }, 60_000);
});
