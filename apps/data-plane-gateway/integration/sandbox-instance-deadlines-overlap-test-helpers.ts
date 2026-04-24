import { systemSleeper } from "@mistle/time";
import { expect } from "vitest";
import { z } from "zod";

import {
  connectBootstrapSocket,
  insertSandboxInstanceRow,
  mintValidBootstrapToken,
  waitForRuntimeState,
} from "./runtime-state-test-helpers.js";
import type { DataPlaneGatewayIntegrationFixture } from "./test-context.js";
import { closeWebSocket, waitForWebSocketClose } from "./websocket-test-helpers.js";

const WorkflowName = "data-plane.sandbox-instance-deadlines.handle";
const WorkflowQueuePollIntervalMs = 100;
const WorkflowQueueWaitTimeoutMs = 10_000;
const DeadlinePollIntervalMs = 100;
const DeadlineWaitTimeoutMs = 10_000;

type WorkflowRunRow = {
  id: string;
  workflow_name: string;
  status: string;
  input: unknown;
  available_at: string;
  idempotency_key: string | null;
};

const WorkflowRunInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    kind: z.enum(["idle", "disconnect"]),
    ownerLeaseId: z.string().min(1),
    dueAt: z.string().min(1),
    generation: z.number().int().min(1),
  })
  .strict();

function canonicalizeIsoString(value: string): string {
  return new Date(value).toISOString();
}

async function waitForDeadlineRow(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
  kind: "idle" | "disconnect";
  predicate: (row: {
    ownerLeaseId: string;
    dueAt: string;
    generation: number;
    clearedAt: string | null;
  }) => boolean;
}): Promise<{
  ownerLeaseId: string;
  dueAt: string;
  generation: number;
  clearedAt: string | null;
}> {
  const deadlineMs = Date.now() + DeadlineWaitTimeoutMs;

  while (Date.now() < deadlineMs) {
    const row = await input.fixture.db.query.sandboxInstanceDeadlines.findFirst({
      columns: {
        ownerLeaseId: true,
        dueAt: true,
        generation: true,
        clearedAt: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxInstanceId, input.sandboxInstanceId), eq(table.kind, input.kind)),
    });
    if (row !== undefined && input.predicate(row)) {
      return row;
    }

    await systemSleeper.sleep(DeadlinePollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for ${input.kind} deadline row for sandbox '${input.sandboxInstanceId}'.`,
  );
}

async function waitForWorkflowRuns(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
  minimumCount: number;
}): Promise<WorkflowRunRow[]> {
  const deadlineMs = Date.now() + WorkflowQueueWaitTimeoutMs;

  while (Date.now() < deadlineMs) {
    const result = await input.fixture.dbPool.query<WorkflowRunRow>(
      `
        select id, workflow_name, status, input, available_at, idempotency_key
        from data_plane_openworkflow.workflow_runs
        where
          namespace_id = $1
          and workflow_name = $2
          and input->>'sandboxInstanceId' = $3
        order by created_at asc
      `,
      [input.fixture.workflowNamespaceId, WorkflowName, input.sandboxInstanceId],
    );
    if (result.rows.length >= input.minimumCount) {
      return result.rows;
    }

    await systemSleeper.sleep(WorkflowQueuePollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued deadline workflow runs for sandbox '${input.sandboxInstanceId}'.`,
  );
}

async function waitForBlockedDeadlineMutation(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  minimumCount?: number;
}): Promise<void> {
  const deadlineMs = Date.now() + DeadlineWaitTimeoutMs;
  const minimumCount = input.minimumCount ?? 1;

  while (Date.now() < deadlineMs) {
    const result = await input.fixture.dbPool.query<{ waiters: number }>(
      `
        select count(*)::int as waiters
        from pg_stat_activity
        where
          datname = current_database()
          and wait_event_type = 'Lock'
          and state = 'active'
          and query ilike '%sandbox_instance_deadlines%'
      `,
    );

    if ((result.rows[0]?.waiters ?? 0) >= minimumCount) {
      return;
    }

    await systemSleeper.sleep(WorkflowQueuePollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for ${String(minimumCount)} blocked sandbox deadline mutation(s).`,
  );
}

export async function exerciseOverlappingBootstrapReplacement(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
  testId: string;
}): Promise<void> {
  await insertSandboxInstanceRow({
    fixture: input.fixture,
    sandboxInstanceId: input.sandboxInstanceId,
    testId: input.testId,
  });

  const firstBootstrapSocket = await connectBootstrapSocket({
    fixture: input.fixture,
    sandboxInstanceId: input.sandboxInstanceId,
    token: await mintValidBootstrapToken({
      fixture: input.fixture,
      sandboxInstanceId: input.sandboxInstanceId,
    }),
  });
  const firstRuntimeState = await waitForRuntimeState({
    fixture: input.fixture,
    sandboxInstanceId: input.sandboxInstanceId,
    predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
  });
  if (firstRuntimeState.ownerLeaseId === null) {
    throw new Error("Expected an owner lease id after the first bootstrap attachment.");
  }

  const firstIdleDeadline = await waitForDeadlineRow({
    fixture: input.fixture,
    sandboxInstanceId: input.sandboxInstanceId,
    kind: "idle",
    predicate: (row) =>
      row.ownerLeaseId === firstRuntimeState.ownerLeaseId &&
      row.generation === 1 &&
      row.clearedAt === null,
  });

  const lockClient = await input.fixture.dbPool.connect();
  let firstBootstrapSocketClose: ReturnType<typeof waitForWebSocketClose> | undefined;
  let secondBootstrapSocket: Awaited<ReturnType<typeof connectBootstrapSocket>> | undefined;
  try {
    await lockClient.query("BEGIN");
    await lockClient.query(
      `
        select 1
        from "data_plane"."sandbox_instance_deadlines"
        where sandbox_instance_id = $1
          and kind = 'idle'
        for update
      `,
      [input.sandboxInstanceId],
    );

    firstBootstrapSocketClose = waitForWebSocketClose(firstBootstrapSocket);
    firstBootstrapSocket.close();
    await waitForBlockedDeadlineMutation({
      fixture: input.fixture,
    });

    secondBootstrapSocket = await connectBootstrapSocket({
      fixture: input.fixture,
      sandboxInstanceId: input.sandboxInstanceId,
      token: await mintValidBootstrapToken({
        fixture: input.fixture,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
    });
    const secondRuntimeState = await waitForRuntimeState({
      fixture: input.fixture,
      sandboxInstanceId: input.sandboxInstanceId,
      predicate: (snapshot) =>
        snapshot.ownerLeaseId !== null &&
        snapshot.ownerLeaseId !== firstRuntimeState.ownerLeaseId &&
        snapshot.attachment !== null,
    });
    if (secondRuntimeState.ownerLeaseId === null) {
      throw new Error("Expected a new owner lease id after overlapping bootstrap attach.");
    }

    await lockClient.query("COMMIT");

    const replacementIdleDeadline = await waitForDeadlineRow({
      fixture: input.fixture,
      sandboxInstanceId: input.sandboxInstanceId,
      kind: "idle",
      predicate: (row) =>
        row.ownerLeaseId === secondRuntimeState.ownerLeaseId &&
        row.generation === 2 &&
        row.clearedAt === null,
    });
    const clearedDisconnectDeadline = await waitForDeadlineRow({
      fixture: input.fixture,
      sandboxInstanceId: input.sandboxInstanceId,
      kind: "disconnect",
      predicate: (row) =>
        row.ownerLeaseId === firstRuntimeState.ownerLeaseId &&
        row.generation === 1 &&
        row.clearedAt !== null,
    });
    const workflowRuns = await waitForWorkflowRuns({
      fixture: input.fixture,
      sandboxInstanceId: input.sandboxInstanceId,
      minimumCount: 3,
    });
    const parsedWorkflowInputs = workflowRuns.map((run) => WorkflowRunInputSchema.parse(run.input));

    expect(parsedWorkflowInputs).toEqual(
      expect.arrayContaining([
        {
          sandboxInstanceId: input.sandboxInstanceId,
          kind: "idle",
          ownerLeaseId: firstRuntimeState.ownerLeaseId,
          generation: firstIdleDeadline.generation,
          dueAt: canonicalizeIsoString(firstIdleDeadline.dueAt),
        },
        {
          sandboxInstanceId: input.sandboxInstanceId,
          kind: "disconnect",
          ownerLeaseId: firstRuntimeState.ownerLeaseId,
          generation: clearedDisconnectDeadline.generation,
          dueAt: canonicalizeIsoString(clearedDisconnectDeadline.dueAt),
        },
        {
          sandboxInstanceId: input.sandboxInstanceId,
          kind: "idle",
          ownerLeaseId: secondRuntimeState.ownerLeaseId,
          generation: replacementIdleDeadline.generation,
          dueAt: canonicalizeIsoString(replacementIdleDeadline.dueAt),
        },
      ]),
    );

    await waitForRuntimeState({
      fixture: input.fixture,
      sandboxInstanceId: input.sandboxInstanceId,
      predicate: (snapshot) =>
        snapshot.ownerLeaseId === secondRuntimeState.ownerLeaseId && snapshot.attachment !== null,
    });
  } finally {
    try {
      await lockClient.query("ROLLBACK");
    } catch {}
    lockClient.release();
    if (firstBootstrapSocketClose === undefined) {
      await closeWebSocket(firstBootstrapSocket);
    } else {
      await firstBootstrapSocketClose;
    }
    if (secondBootstrapSocket !== undefined) {
      await closeWebSocket(secondBootstrapSocket);
    }
  }
}
