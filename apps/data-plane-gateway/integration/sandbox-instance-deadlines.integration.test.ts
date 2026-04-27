/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { randomUUID } from "node:crypto";

import { sandboxInstanceDeadlines, SandboxInstanceDeadlineKinds } from "@mistle/db/data-plane";
import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { systemSleeper } from "@mistle/time";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";
import { z } from "zod";

import {
  connectBootstrapSocket,
  insertSandboxInstanceRow,
  mintValidBootstrapToken,
  waitForRuntimeState,
} from "./runtime-state-test-helpers.js";
import { exerciseOverlappingBootstrapReplacement } from "./sandbox-instance-deadlines-overlap-test-helpers.js";
import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";
import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  waitForWebSocketClose,
} from "./websocket-test-helpers.js";

const IntegrationTestTimeoutMs = 60_000;
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

function expectWorkflowRunMatchesDeadline(input: {
  workflowRun: WorkflowRunRow;
  sandboxInstanceId: string;
  kind: "idle" | "disconnect";
  ownerLeaseId: string;
  generation: number;
  dueAt: string;
}): void {
  expect(input.workflowRun.workflow_name).toBe(WorkflowName);
  expect(input.workflowRun.status).toBe("pending");
  expect(WorkflowRunInputSchema.parse(input.workflowRun.input)).toEqual({
    sandboxInstanceId: input.sandboxInstanceId,
    kind: input.kind,
    ownerLeaseId: input.ownerLeaseId,
    dueAt: input.dueAt,
    generation: input.generation,
  });
  expect(canonicalizeIsoString(input.workflowRun.available_at)).toBe(input.dueAt);
  expect(input.workflowRun.idempotency_key).toBe(
    `deadline:${input.sandboxInstanceId}:${input.kind}:${input.ownerLeaseId}:${input.dueAt}:${String(input.generation)}`,
  );
}

describe("sandbox instance deadlines integration", () => {
  it(
    "clears disconnect and schedules idle when the bootstrap peer attaches",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "gateway_deadline_bootstrap_attach",
      });
      await fixture.db.insert(sandboxInstanceDeadlines).values({
        sandboxInstanceId,
        kind: SandboxInstanceDeadlineKinds.DISCONNECT,
        ownerLeaseId: "dtl_old_bootstrap_attach",
        dueAt: "2026-04-15T12:00:00.000Z",
        generation: 1,
      });

      const bootstrapSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
        token: await mintValidBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
      });
      const runtimeState = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
      });
      if (runtimeState.ownerLeaseId === null) {
        throw new Error("Expected an owner lease id after bootstrap attachment.");
      }

      const idleDeadline = await waitForDeadlineRow({
        fixture,
        sandboxInstanceId,
        kind: "idle",
        predicate: (row) =>
          row.ownerLeaseId === runtimeState.ownerLeaseId && row.clearedAt === null,
      });
      const clearedDisconnectDeadline = await waitForDeadlineRow({
        fixture,
        sandboxInstanceId,
        kind: "disconnect",
        predicate: (row) => row.clearedAt !== null,
      });
      const workflowRuns = await waitForWorkflowRuns({
        fixture,
        sandboxInstanceId,
        minimumCount: 1,
      });

      expect(idleDeadline.generation).toBe(1);
      expect(clearedDisconnectDeadline.ownerLeaseId).toBe("dtl_old_bootstrap_attach");
      expect(clearedDisconnectDeadline.clearedAt).toEqual(expect.any(String));
      expect(workflowRuns).toHaveLength(1);
      expectWorkflowRunMatchesDeadline({
        workflowRun: workflowRuns[0]!,
        sandboxInstanceId,
        kind: "idle",
        ownerLeaseId: runtimeState.ownerLeaseId,
        generation: idleDeadline.generation,
        dueAt: canonicalizeIsoString(idleDeadline.dueAt),
      });

      await closeWebSocket(bootstrapSocket);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "clears the stale disconnect deadline when bootstrap disconnect overlaps a replacement attach",
    async ({ fixture }) => {
      await exerciseOverlappingBootstrapReplacement({
        fixture,
        sandboxInstanceId: typeid("sbi").toString(),
        testId: "gateway_deadline_overlap_disconnect_attach",
      });
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "reschedules idle when a connection peer renews presence",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "gateway_deadline_presence_touch",
      });

      const bootstrapSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
        token: await mintValidBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
      });
      const connectedRuntimeState = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
      });
      if (connectedRuntimeState.ownerLeaseId === null) {
        throw new Error("Expected an owner lease id after bootstrap attachment.");
      }

      await waitForDeadlineRow({
        fixture,
        sandboxInstanceId,
        kind: "idle",
        predicate: (row) =>
          row.ownerLeaseId === connectedRuntimeState.ownerLeaseId &&
          row.generation === 1 &&
          row.clearedAt === null,
      });

      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const connectionSocket = await connectSandboxTunnelWebSocket({
        websocketBaseUrl: fixture.websocketBaseUrl,
        sandboxInstanceId,
        tokenKind: "connect",
        token: connectionToken,
      });

      const rescheduledIdleDeadline = await waitForDeadlineRow({
        fixture,
        sandboxInstanceId,
        kind: "idle",
        predicate: (row) =>
          row.ownerLeaseId === connectedRuntimeState.ownerLeaseId &&
          row.generation === 2 &&
          row.clearedAt === null,
      });
      const workflowRuns = await waitForWorkflowRuns({
        fixture,
        sandboxInstanceId,
        minimumCount: 2,
      });

      expectWorkflowRunMatchesDeadline({
        workflowRun: workflowRuns[1]!,
        sandboxInstanceId,
        kind: "idle",
        ownerLeaseId: connectedRuntimeState.ownerLeaseId,
        generation: rescheduledIdleDeadline.generation,
        dueAt: canonicalizeIsoString(rescheduledIdleDeadline.dueAt),
      });

      await closeWebSocket(connectionSocket);
      await closeWebSocket(bootstrapSocket);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "clears disconnect and replaces idle when the bootstrap peer reattaches",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "gateway_deadline_bootstrap_reattach",
      });

      const firstBootstrapSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
        token: await mintValidBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
      });
      const firstRuntimeState = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
      });
      if (firstRuntimeState.ownerLeaseId === null) {
        throw new Error("Expected an owner lease id after the first bootstrap attachment.");
      }

      await waitForDeadlineRow({
        fixture,
        sandboxInstanceId,
        kind: "idle",
        predicate: (row) =>
          row.ownerLeaseId === firstRuntimeState.ownerLeaseId &&
          row.generation === 1 &&
          row.clearedAt === null,
      });

      await closeWebSocket(firstBootstrapSocket);

      await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (snapshot) => snapshot.ownerLeaseId === null && snapshot.attachment === null,
      });
      await waitForDeadlineRow({
        fixture,
        sandboxInstanceId,
        kind: "disconnect",
        predicate: (row) =>
          row.ownerLeaseId === firstRuntimeState.ownerLeaseId &&
          row.generation === 1 &&
          row.clearedAt === null,
      });

      const secondBootstrapSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
        token: await mintValidBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
      });
      const secondRuntimeState = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (snapshot) =>
          snapshot.ownerLeaseId !== null &&
          snapshot.ownerLeaseId !== firstRuntimeState.ownerLeaseId &&
          snapshot.attachment !== null,
      });
      if (secondRuntimeState.ownerLeaseId === null) {
        throw new Error("Expected an owner lease id after bootstrap reattachment.");
      }

      const replacementIdleDeadline = await waitForDeadlineRow({
        fixture,
        sandboxInstanceId,
        kind: "idle",
        predicate: (row) =>
          row.ownerLeaseId === secondRuntimeState.ownerLeaseId &&
          row.generation === 2 &&
          row.clearedAt === null,
      });
      const clearedDisconnectDeadline = await waitForDeadlineRow({
        fixture,
        sandboxInstanceId,
        kind: "disconnect",
        predicate: (row) =>
          row.ownerLeaseId === firstRuntimeState.ownerLeaseId && row.clearedAt !== null,
      });
      const workflowRuns = await waitForWorkflowRuns({
        fixture,
        sandboxInstanceId,
        minimumCount: 3,
      });

      expect(clearedDisconnectDeadline.clearedAt).toEqual(expect.any(String));
      expectWorkflowRunMatchesDeadline({
        workflowRun: workflowRuns[2]!,
        sandboxInstanceId,
        kind: "idle",
        ownerLeaseId: secondRuntimeState.ownerLeaseId,
        generation: replacementIdleDeadline.generation,
        dueAt: canonicalizeIsoString(replacementIdleDeadline.dueAt),
      });

      await closeWebSocket(secondBootstrapSocket);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "replaces the idle deadline row when the active bootstrap session changes",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "gateway_deadline_owner_replacement",
      });

      const firstBootstrapSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
        token: await mintValidBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
      });
      const firstRuntimeState = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
      });
      if (firstRuntimeState.ownerLeaseId === null) {
        throw new Error("Expected an owner lease id after the first bootstrap attachment.");
      }

      await waitForDeadlineRow({
        fixture,
        sandboxInstanceId,
        kind: "idle",
        predicate: (row) =>
          row.ownerLeaseId === firstRuntimeState.ownerLeaseId &&
          row.generation === 1 &&
          row.clearedAt === null,
      });

      const firstBootstrapClose = waitForWebSocketClose(firstBootstrapSocket);
      const secondBootstrapSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
        token: await mintValidBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
      });
      const secondRuntimeState = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (snapshot) =>
          snapshot.ownerLeaseId !== null &&
          snapshot.ownerLeaseId !== firstRuntimeState.ownerLeaseId &&
          snapshot.attachment !== null,
      });
      if (secondRuntimeState.ownerLeaseId === null) {
        throw new Error("Expected a new owner lease id after bootstrap replacement.");
      }

      const replacedIdleDeadline = await waitForDeadlineRow({
        fixture,
        sandboxInstanceId,
        kind: "idle",
        predicate: (row) =>
          row.ownerLeaseId === secondRuntimeState.ownerLeaseId &&
          row.generation === 2 &&
          row.clearedAt === null,
      });
      const workflowRuns = await waitForWorkflowRuns({
        fixture,
        sandboxInstanceId,
        minimumCount: 2,
      });

      expect((await firstBootstrapClose).code).toBe(1012);
      expectWorkflowRunMatchesDeadline({
        workflowRun: workflowRuns[1]!,
        sandboxInstanceId,
        kind: "idle",
        ownerLeaseId: secondRuntimeState.ownerLeaseId,
        generation: replacedIdleDeadline.generation,
        dueAt: canonicalizeIsoString(replacedIdleDeadline.dueAt),
      });

      await closeWebSocket(secondBootstrapSocket);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "reschedules idle when the bootstrap peer reports active keepalive",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "gateway_deadline_keepalive_touch",
      });

      const bootstrapSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
        token: await mintValidBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
      });
      const connectedRuntimeState = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
      });
      if (connectedRuntimeState.ownerLeaseId === null) {
        throw new Error("Expected an owner lease id after bootstrap attachment.");
      }

      await waitForDeadlineRow({
        fixture,
        sandboxInstanceId,
        kind: "idle",
        predicate: (row) =>
          row.ownerLeaseId === connectedRuntimeState.ownerLeaseId &&
          row.generation === 1 &&
          row.clearedAt === null,
      });

      bootstrapSocket.send(
        JSON.stringify({
          type: "keepalive.state",
          ttlMs: 30_000,
          active: true,
        }),
      );

      const rescheduledIdleDeadline = await waitForDeadlineRow({
        fixture,
        sandboxInstanceId,
        kind: "idle",
        predicate: (row) =>
          row.ownerLeaseId === connectedRuntimeState.ownerLeaseId &&
          row.generation === 2 &&
          row.clearedAt === null,
      });
      const workflowRuns = await waitForWorkflowRuns({
        fixture,
        sandboxInstanceId,
        minimumCount: 2,
      });

      expectWorkflowRunMatchesDeadline({
        workflowRun: workflowRuns[1]!,
        sandboxInstanceId,
        kind: "idle",
        ownerLeaseId: connectedRuntimeState.ownerLeaseId,
        generation: rescheduledIdleDeadline.generation,
        dueAt: canonicalizeIsoString(rescheduledIdleDeadline.dueAt),
      });

      await closeWebSocket(bootstrapSocket);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "clears idle and schedules disconnect when the bootstrap peer disconnects",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "gateway_deadline_bootstrap_disconnect",
      });

      const bootstrapSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
        token: await mintValidBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
      });
      const connectedRuntimeState = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
      });
      if (connectedRuntimeState.ownerLeaseId === null) {
        throw new Error("Expected an owner lease id after bootstrap attachment.");
      }

      await waitForDeadlineRow({
        fixture,
        sandboxInstanceId,
        kind: "idle",
        predicate: (row) =>
          row.ownerLeaseId === connectedRuntimeState.ownerLeaseId &&
          row.generation === 1 &&
          row.clearedAt === null,
      });

      await closeWebSocket(bootstrapSocket);

      await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (snapshot) => snapshot.ownerLeaseId === null && snapshot.attachment === null,
      });
      const clearedIdleDeadline = await waitForDeadlineRow({
        fixture,
        sandboxInstanceId,
        kind: "idle",
        predicate: (row) =>
          row.ownerLeaseId === connectedRuntimeState.ownerLeaseId && row.clearedAt !== null,
      });
      const disconnectDeadline = await waitForDeadlineRow({
        fixture,
        sandboxInstanceId,
        kind: "disconnect",
        predicate: (row) =>
          row.ownerLeaseId === connectedRuntimeState.ownerLeaseId &&
          row.generation === 1 &&
          row.clearedAt === null,
      });
      const workflowRuns = await waitForWorkflowRuns({
        fixture,
        sandboxInstanceId,
        minimumCount: 2,
      });

      expect(clearedIdleDeadline.clearedAt).toEqual(expect.any(String));
      expectWorkflowRunMatchesDeadline({
        workflowRun: workflowRuns[1]!,
        sandboxInstanceId,
        kind: "disconnect",
        ownerLeaseId: connectedRuntimeState.ownerLeaseId,
        generation: disconnectDeadline.generation,
        dueAt: canonicalizeIsoString(disconnectDeadline.dueAt),
      });
    },
    IntegrationTestTimeoutMs,
  );
});
