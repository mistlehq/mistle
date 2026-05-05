/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  createDataPlaneSandboxInstancesClient,
  type DataPlaneSandboxInstancesClient,
} from "@mistle/data-plane-internal-client";
import { SandboxInstanceDeadlineKinds, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { createDataPlaneWorkflowNamespaceId } from "@mistle/db/test-environment";
import {
  createIntegrationTest,
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { systemClock, systemSleeper } from "@mistle/time";
import { HandleSandboxInstanceDeadlineWorkflowName } from "@mistle/workflow-registry/data-plane";
import { sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import { z } from "zod";

import {
  DATA_PLANE_INTERNAL_AUTH_HEADER,
  INTERNAL_SANDBOX_ROUTE_BASE_PATH,
} from "../src/internal/index.js";
import {
  createSandboxInstanceDeadlineAdvisoryLockResourceKey,
  SandboxInstanceDeadlineAdvisoryLockNamespace,
} from "../src/internal/sandbox-instances/services/put-sandbox-instance-deadline.js";

const InternalServiceToken = "integration-new-internal-service-token";
const CanonicalDueAt = "2026-04-15T12:00:00.000Z";
const AlternateCanonicalDueAt = "2026-04-15T12:05:00.000Z";
const WorkflowRunPersistTimeoutMs = 30_000;
const WorkflowRunPersistPollIntervalMs = 100;

const it = createIntegrationTest({
  services: ["data-plane-api"],
});

const DeadlineWorkflowInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    kind: z.enum(["idle", "disconnect"]),
    ownerLeaseId: z.string().min(1),
    dueAt: z.string().min(1),
    generation: z.number().int().min(1),
  })
  .strict();

const LockWaiterCountRowSchema = z
  .object({
    waiters: z.number().int().min(0),
  })
  .strict();

describe.concurrent("internal sandbox instance deadlines integration", () => {
  it("creates, schedules, and clears sandbox instance deadlines", async ({ env }) => {
    const sandboxInstanceId = "sbi_dp_api_deadline_put_delete";
    await insertRunningSandboxInstance(env, sandboxInstanceId);

    const putResponse = await clientFor(env).putSandboxInstanceDeadline({
      sandboxInstanceId,
      kind: "idle",
      ownerLeaseId: "sol_dp_api_deadline_put_delete",
      dueAt: CanonicalDueAt,
    });

    expect(putResponse).toEqual({
      status: "accepted",
      sandboxInstanceId,
      kind: "idle",
      generation: 1,
      workflowRunId: expect.any(String),
    });

    const workflowRuns = await waitForDeadlineWorkflowRuns(env, sandboxInstanceId);
    expect(workflowRuns).toHaveLength(1);
    expect(workflowRuns[0]).toMatchObject({
      id: putResponse.workflowRunId,
      namespace_id: createDataPlaneWorkflowNamespaceId(env.id),
      workflow_name: HandleSandboxInstanceDeadlineWorkflowName,
      status: "pending",
      output: null,
      idempotency_key: expectedDeadlineIdempotencyKey({
        sandboxInstanceId,
        kind: "idle",
        ownerLeaseId: "sol_dp_api_deadline_put_delete",
        dueAt: CanonicalDueAt,
        generation: 1,
      }),
    });
    expect(DeadlineWorkflowInputSchema.parse(workflowRuns[0]?.input)).toEqual({
      sandboxInstanceId,
      kind: "idle",
      ownerLeaseId: "sol_dp_api_deadline_put_delete",
      dueAt: CanonicalDueAt,
      generation: 1,
    });
    expect(canonicalizePersistedDueAt(workflowRuns[0]?.available_at ?? "")).toBe(CanonicalDueAt);

    await expect(readDeadline(env, sandboxInstanceId, "idle")).resolves.toMatchObject({
      ownerLeaseId: "sol_dp_api_deadline_put_delete",
      dueAt: expect.any(String),
      generation: 1,
      clearedAt: null,
    });

    const deleteResponse = await clientFor(env).deleteSandboxInstanceDeadline({
      sandboxInstanceId,
      kind: "idle",
      ownerLeaseId: "sol_dp_api_deadline_put_delete",
    });
    expect(deleteResponse).toEqual({
      status: "ok",
      sandboxInstanceId,
      kind: "idle",
    });

    const clearedDeadline = await readDeadline(env, sandboxInstanceId, "idle");
    expect(clearedDeadline?.clearedAt).toEqual(expect.any(String));
  });

  it("bumps generation after a cleared deadline is reactivated", async ({ env }) => {
    const sandboxInstanceId = "sbi_dp_api_deadline_reactivate";
    await insertRunningSandboxInstance(env, sandboxInstanceId);

    const initialResponse = await clientFor(env).putSandboxInstanceDeadline({
      sandboxInstanceId,
      kind: "disconnect",
      ownerLeaseId: "sol_dp_api_deadline_reactivate",
      dueAt: CanonicalDueAt,
    });
    expect(initialResponse.generation).toBe(1);

    await expect(
      clientFor(env).deleteSandboxInstanceDeadline({
        sandboxInstanceId,
        kind: "disconnect",
        ownerLeaseId: "sol_dp_api_deadline_reactivate",
      }),
    ).resolves.toMatchObject({
      status: "ok",
    });

    const reactivatedResponse = await clientFor(env).putSandboxInstanceDeadline({
      sandboxInstanceId,
      kind: "disconnect",
      ownerLeaseId: "sol_dp_api_deadline_reactivate",
      dueAt: CanonicalDueAt,
    });
    expect(reactivatedResponse.generation).toBe(2);

    await expect(readDeadline(env, sandboxInstanceId, "disconnect")).resolves.toMatchObject({
      generation: 2,
      clearedAt: null,
    });
  });

  it("does not let a stale clear remove a replacement deadline", async ({ env }) => {
    const sandboxInstanceId = "sbi_dp_api_deadline_stale_clear";
    await insertRunningSandboxInstance(env, sandboxInstanceId);

    const oldResponse = await clientFor(env).putSandboxInstanceDeadline({
      sandboxInstanceId,
      kind: "idle",
      ownerLeaseId: "sol_dp_api_deadline_stale_clear_old",
      dueAt: CanonicalDueAt,
    });
    expect(oldResponse.generation).toBe(1);

    const replacementResponse = await clientFor(env).putSandboxInstanceDeadline({
      sandboxInstanceId,
      kind: "idle",
      ownerLeaseId: "sol_dp_api_deadline_stale_clear_replacement",
      dueAt: AlternateCanonicalDueAt,
    });
    expect(replacementResponse.generation).toBe(2);

    await clientFor(env).deleteSandboxInstanceDeadline({
      sandboxInstanceId,
      kind: "idle",
      ownerLeaseId: "sol_dp_api_deadline_stale_clear_old",
    });

    const persistedDeadline = await readDeadline(env, sandboxInstanceId, "idle");
    expect(persistedDeadline).toMatchObject({
      ownerLeaseId: "sol_dp_api_deadline_stale_clear_replacement",
      dueAt: expect.any(String),
      generation: 2,
      clearedAt: null,
    });
    expect(canonicalizePersistedDueAt(persistedDeadline?.dueAt ?? "")).toBe(
      AlternateCanonicalDueAt,
    );
  });

  it("returns ok when deleting a missing or already-cleared deadline", async ({ env }) => {
    await expect(
      clientFor(env).deleteSandboxInstanceDeadline({
        sandboxInstanceId: "sbi_dp_api_deadline_delete_missing",
        kind: "idle",
        ownerLeaseId: "sol_dp_api_deadline_delete_missing",
      }),
    ).resolves.toEqual({
      status: "ok",
      sandboxInstanceId: "sbi_dp_api_deadline_delete_missing",
      kind: "idle",
    });

    const sandboxInstanceId = "sbi_dp_api_deadline_delete_cleared";
    await insertRunningSandboxInstance(env, sandboxInstanceId);
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceDeadlines).values({
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      ownerLeaseId: "sol_dp_api_deadline_delete_cleared",
      dueAt: CanonicalDueAt,
      clearedAt: CanonicalDueAt,
    });

    await expect(
      clientFor(env).deleteSandboxInstanceDeadline({
        sandboxInstanceId,
        kind: "idle",
        ownerLeaseId: "sol_dp_api_deadline_delete_cleared",
      }),
    ).resolves.toEqual({
      status: "ok",
      sandboxInstanceId,
      kind: "idle",
    });
  });

  it("does not schedule a workflow when the deadline row cannot be persisted", async ({ env }) => {
    const sandboxInstanceId = "sbi_dp_api_deadline_missing_instance";
    const response = await env.dataPlaneApi.http.fetch(
      `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/${sandboxInstanceId}/deadlines/idle`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: InternalServiceToken,
        },
        body: JSON.stringify({
          ownerLeaseId: "sol_dp_api_deadline_missing_instance",
          dueAt: CanonicalDueAt,
        }),
      },
    );

    expect(response.status).toBe(500);
    await expect(listDeadlineWorkflowRuns(env, sandboxInstanceId)).resolves.toHaveLength(0);
    await expect(readDeadline(env, sandboxInstanceId, "idle")).resolves.toBeUndefined();
  });

  it("rejects non-canonical dueAt values", async ({ env }) => {
    const sandboxInstanceId = "sbi_dp_api_deadline_invalid_due_at";
    await insertRunningSandboxInstance(env, sandboxInstanceId);

    const response = await env.dataPlaneApi.http.fetch(
      `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/${sandboxInstanceId}/deadlines/idle`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: InternalServiceToken,
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
  });

  it("applies last-write-wins semantics for concurrent deadline writes", async ({ env }) => {
    const sandboxInstanceId = "sbi_dp_api_deadline_concurrent_put";
    await insertRunningSandboxInstance(env, sandboxInstanceId);
    let firstRequestPromise:
      | ReturnType<DataPlaneSandboxInstancesClient["putSandboxInstanceDeadline"]>
      | undefined;
    let secondRequestPromise:
      | ReturnType<DataPlaneSandboxInstancesClient["putSandboxInstanceDeadline"]>
      | undefined;

    await env.dataPlaneDb.transaction(async (transaction) => {
      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          ${SandboxInstanceDeadlineAdvisoryLockNamespace},
          hashtext(${createSandboxInstanceDeadlineAdvisoryLockResourceKey({
            sandboxInstanceId,
            kind: "disconnect",
          })})
        )
      `);

      const client = clientFor(env, 15_000);
      firstRequestPromise = client.putSandboxInstanceDeadline({
        sandboxInstanceId,
        kind: "disconnect",
        ownerLeaseId: "sol_dp_api_deadline_concurrent_put_first",
        dueAt: CanonicalDueAt,
      });
      await waitForPendingDeadlineWriteLockWaiters({
        env,
        sandboxInstanceId,
        kind: "disconnect",
      });

      secondRequestPromise = client.putSandboxInstanceDeadline({
        sandboxInstanceId,
        kind: "disconnect",
        ownerLeaseId: "sol_dp_api_deadline_concurrent_put_second",
        dueAt: AlternateCanonicalDueAt,
      });
      await waitForPendingDeadlineWriteLockWaiters({
        env,
        sandboxInstanceId,
        minimumCount: 2,
        kind: "disconnect",
      });
    });

    if (firstRequestPromise === undefined || secondRequestPromise === undefined) {
      throw new Error("Expected both concurrent deadline requests to be started.");
    }

    const [firstResponse, secondResponse] = await Promise.all([
      firstRequestPromise,
      secondRequestPromise,
    ]);
    expect(firstResponse.status).toBe("accepted");
    expect(secondResponse.status).toBe("accepted");

    const workflowRuns = await waitForDeadlineWorkflowRuns(env, sandboxInstanceId, 2);
    expect(workflowRuns).toHaveLength(2);

    const parsedInputs = workflowRuns.map((run) => DeadlineWorkflowInputSchema.parse(run.input));
    expect(parsedInputs).toEqual(
      expect.arrayContaining([
        {
          sandboxInstanceId,
          kind: "disconnect",
          ownerLeaseId: "sol_dp_api_deadline_concurrent_put_first",
          dueAt: CanonicalDueAt,
          generation: 1,
        },
        {
          sandboxInstanceId,
          kind: "disconnect",
          ownerLeaseId: "sol_dp_api_deadline_concurrent_put_second",
          dueAt: AlternateCanonicalDueAt,
          generation: 2,
        },
      ]),
    );

    const persistedDeadline = await readDeadline(env, sandboxInstanceId, "disconnect");
    expect(persistedDeadline).toEqual({
      ownerLeaseId: "sol_dp_api_deadline_concurrent_put_second",
      dueAt: expect.any(String),
      generation: 2,
      clearedAt: null,
    });
    expect(canonicalizePersistedDueAt(persistedDeadline?.dueAt ?? "")).toBe(
      AlternateCanonicalDueAt,
    );
  });
});

function clientFor(
  env: IntegrationTestEnvironment,
  requestTimeoutMs?: number,
): DataPlaneSandboxInstancesClient {
  return createDataPlaneSandboxInstancesClient({
    baseUrl: env.dataPlaneApi.hostBaseUrl,
    serviceToken: InternalServiceToken,
    testEnvironmentId: env.id,
    testEnvironmentIdHeader: TestEnvironmentIdHeader,
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
  });
}

async function insertRunningSandboxInstance(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: sandboxInstanceId,
    organizationId: `org_${sandboxInstanceId}`,
    sandboxProfileId: `sbp_${sandboxInstanceId}`,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${sandboxInstanceId}`,
    status: SandboxInstanceStatuses.RUNNING,
    startedByKind: "user",
    startedById: `usr_${sandboxInstanceId}`,
    source: "dashboard",
  });
}

type DeadlineKind = "idle" | "disconnect";

function readDeadline(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
  kind: DeadlineKind,
) {
  return env.dataPlaneDb.query.sandboxInstanceDeadlines.findFirst({
    columns: {
      ownerLeaseId: true,
      dueAt: true,
      generation: true,
      clearedAt: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.sandboxInstanceId, sandboxInstanceId), eq(table.kind, kind)),
  });
}

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

const WorkflowRunRowSchema = z
  .object({
    id: z.string(),
    namespace_id: z.string(),
    workflow_name: z.string(),
    status: z.string(),
    input: z.unknown(),
    output: z.null(),
    idempotency_key: z.string().nullable(),
    available_at: z.string(),
  })
  .strict();

async function waitForDeadlineWorkflowRuns(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
  minimumCount = 1,
): Promise<WorkflowRunRow[]> {
  const deadline = systemClock.nowMs() + WorkflowRunPersistTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    const workflowRuns = await listDeadlineWorkflowRuns(env, sandboxInstanceId);
    if (workflowRuns.length >= minimumCount) {
      return workflowRuns;
    }

    await systemSleeper.sleep(WorkflowRunPersistPollIntervalMs);
  }

  throw new Error(`Timed out waiting for deadline workflow for sandbox '${sandboxInstanceId}'.`);
}

async function waitForPendingDeadlineWriteLockWaiters(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
  kind: DeadlineKind;
  minimumCount?: number;
}): Promise<void> {
  const deadline = systemClock.nowMs() + WorkflowRunPersistTimeoutMs;
  const minimumCount = input.minimumCount ?? 1;
  const resourceKey = createSandboxInstanceDeadlineAdvisoryLockResourceKey({
    sandboxInstanceId: input.sandboxInstanceId,
    kind: input.kind,
  });

  while (systemClock.nowMs() < deadline) {
    const result = await input.env.dataPlaneDb.execute(sql<{ waiters: number }>`
      select count(*)::int as waiters
      from pg_locks
      where
        locktype = 'advisory'
        and classid = ${SandboxInstanceDeadlineAdvisoryLockNamespace}
        and objid = hashtext(${resourceKey})
        and objsubid = 2
      and granted = false
    `);
    const waiterCount = LockWaiterCountRowSchema.parse(result.rows[0] ?? { waiters: 0 }).waiters;

    if (waiterCount >= minimumCount) {
      return;
    }

    await systemSleeper.sleep(WorkflowRunPersistPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for ${String(minimumCount)} pending deadline lock waiter(s) for sandbox '${input.sandboxInstanceId}' and kind '${input.kind}'.`,
  );
}

async function listDeadlineWorkflowRuns(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
): Promise<WorkflowRunRow[]> {
  const namespaceId = createDataPlaneWorkflowNamespaceId(env.id);
  const result = await env.dataPlaneDb.execute(sql<WorkflowRunRow>`
    select id, namespace_id, workflow_name, status, input, output, idempotency_key, available_at
    from data_plane_openworkflow.workflow_runs
    where
      namespace_id = ${namespaceId}
      and workflow_name = ${HandleSandboxInstanceDeadlineWorkflowName}
      and input->>'sandboxInstanceId' = ${sandboxInstanceId}
    order by created_at asc
  `);

  return result.rows.map((row) => WorkflowRunRowSchema.parse(row));
}

function expectedDeadlineIdempotencyKey(input: {
  sandboxInstanceId: string;
  kind: DeadlineKind;
  ownerLeaseId: string;
  dueAt: string;
  generation: number;
}): string {
  return `deadline:${input.sandboxInstanceId}:${input.kind}:${input.ownerLeaseId}:${input.dueAt}:${String(input.generation)}`;
}

function canonicalizePersistedDueAt(dueAt: string): string {
  return new Date(dueAt).toISOString();
}
