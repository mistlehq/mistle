/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceDeadlineKinds, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { createDataPlaneWorkflowNamespaceId } from "@mistle/db/test-environment";
import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  SandboxRuntimeStateSnapshotSchema,
  type SandboxRuntimeStateSnapshot,
} from "@mistle/sandbox-runtime-contract";
import {
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
  createIntegrationTest,
} from "@mistle/test-harness/integration";
import { systemClock, systemSleeper } from "@mistle/time";
import { sql } from "drizzle-orm";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";
import WebSocket from "ws";
import { z } from "zod";

import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
  waitForWebSocketClose,
} from "../integration/websocket-test-helpers.js";

const TestTimeoutMs = 60_000;
const RuntimeStateReadTimeoutMs = 5_000;
const RuntimeStateReadPollIntervalMs = 50;
const DeadlineWaitTimeoutMs = 10_000;
const DeadlinePollIntervalMs = 100;
const WorkflowQueueWaitTimeoutMs = 10_000;
const WorkflowQueuePollIntervalMs = 100;
const InternalServiceTokenHeader = "x-mistle-service-token";
const DeadlineWorkflowName = "data-plane.sandbox-instance-deadlines.handle";
const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";
const ConnectionTokenSecret = "integration-new-connection-secret";
const ConnectionTokenIssuer = "integration-new-control-plane-api";

type DeadlineKind = "idle" | "disconnect";

type DeadlineRow = {
  ownerLeaseId: string;
  dueAt: string;
  generation: number;
  clearedAt: string | null;
};

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

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
});

describe.concurrent("sandbox instance deadlines integration", () => {
  it(
    "schedules idle without blindly clearing a prior disconnect when the bootstrap peer attaches",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
        testId: "gateway_deadline_bootstrap_attach",
      });
      await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceDeadlines).values({
        sandboxInstanceId,
        kind: SandboxInstanceDeadlineKinds.DISCONNECT,
        ownerLeaseId: "dtl_old_bootstrap_attach",
        dueAt: "2026-04-15T12:00:00.000Z",
        generation: 1,
      });

      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });

      try {
        const runtimeState = await waitForRuntimeState({
          env,
          sandboxInstanceId,
          predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
        });
        const ownerLeaseId = readOwnerLeaseId(runtimeState);
        const idleDeadline = await waitForDeadlineRow({
          env,
          sandboxInstanceId,
          kind: "idle",
          predicate: (row) => row.ownerLeaseId === ownerLeaseId && row.clearedAt === null,
        });
        const priorDisconnectDeadline = await waitForDeadlineRow({
          env,
          sandboxInstanceId,
          kind: "disconnect",
          predicate: (row) =>
            row.ownerLeaseId === "dtl_old_bootstrap_attach" && row.clearedAt === null,
        });
        const workflowRuns = await waitForWorkflowRuns({
          env,
          sandboxInstanceId,
          minimumCount: 1,
        });

        expect(idleDeadline.generation).toBe(1);
        expect(priorDisconnectDeadline.generation).toBe(1);
        expect(workflowRuns).toHaveLength(1);
        expectWorkflowRunMatchesDeadline({
          workflowRun: workflowRuns[0]!,
          sandboxInstanceId,
          kind: "idle",
          ownerLeaseId,
          generation: idleDeadline.generation,
          dueAt: canonicalizeIsoString(idleDeadline.dueAt),
        });
      } finally {
        await closeIfOpen(bootstrapSocket);
      }
    },
    TestTimeoutMs,
  );

  it(
    "reschedules idle when a connection peer renews presence",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
        testId: "gateway_deadline_presence_touch",
      });

      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      let connectionSocket: WebSocket | undefined;

      try {
        const runtimeState = await waitForRuntimeState({
          env,
          sandboxInstanceId,
          predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
        });
        const ownerLeaseId = readOwnerLeaseId(runtimeState);
        await waitForDeadlineRow({
          env,
          sandboxInstanceId,
          kind: "idle",
          predicate: (row) =>
            row.ownerLeaseId === ownerLeaseId && row.generation === 1 && row.clearedAt === null,
        });

        connectionSocket = await connectConnectionSocket({
          env,
          sandboxInstanceId,
        });

        const rescheduledIdleDeadline = await waitForDeadlineRow({
          env,
          sandboxInstanceId,
          kind: "idle",
          predicate: (row) =>
            row.ownerLeaseId === ownerLeaseId && row.generation === 2 && row.clearedAt === null,
        });
        const workflowRuns = await waitForWorkflowRuns({
          env,
          sandboxInstanceId,
          minimumCount: 2,
        });

        expectWorkflowRunMatchesDeadline({
          workflowRun: workflowRuns[1]!,
          sandboxInstanceId,
          kind: "idle",
          ownerLeaseId,
          generation: rescheduledIdleDeadline.generation,
          dueAt: canonicalizeIsoString(rescheduledIdleDeadline.dueAt),
        });
      } finally {
        await Promise.all([closeIfOpen(connectionSocket), closeIfOpen(bootstrapSocket)]);
      }
    },
    TestTimeoutMs,
  );

  it(
    "clears disconnect and replaces idle when the bootstrap peer reattaches",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
        testId: "gateway_deadline_bootstrap_reattach",
      });

      const firstBootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const firstRuntimeState = await waitForRuntimeState({
        env,
        sandboxInstanceId,
        predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
      });
      const firstOwnerLeaseId = readOwnerLeaseId(firstRuntimeState);
      await waitForDeadlineRow({
        env,
        sandboxInstanceId,
        kind: "idle",
        predicate: (row) =>
          row.ownerLeaseId === firstOwnerLeaseId && row.generation === 1 && row.clearedAt === null,
      });

      await closeWebSocket(firstBootstrapSocket);
      await waitForRuntimeState({
        env,
        sandboxInstanceId,
        predicate: (snapshot) => snapshot.ownerLeaseId === null && snapshot.attachment === null,
      });
      await waitForDeadlineRow({
        env,
        sandboxInstanceId,
        kind: "disconnect",
        predicate: (row) =>
          row.ownerLeaseId === firstOwnerLeaseId && row.generation === 1 && row.clearedAt === null,
      });

      const secondBootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });

      try {
        const secondRuntimeState = await waitForRuntimeState({
          env,
          sandboxInstanceId,
          predicate: (snapshot) =>
            snapshot.ownerLeaseId !== null &&
            snapshot.ownerLeaseId !== firstOwnerLeaseId &&
            snapshot.attachment !== null,
        });
        const secondOwnerLeaseId = readOwnerLeaseId(secondRuntimeState);
        const replacementIdleDeadline = await waitForDeadlineRow({
          env,
          sandboxInstanceId,
          kind: "idle",
          predicate: (row) =>
            row.ownerLeaseId === secondOwnerLeaseId &&
            row.generation === 2 &&
            row.clearedAt === null,
        });
        const staleDisconnectDeadline = await waitForDeadlineRow({
          env,
          sandboxInstanceId,
          kind: "disconnect",
          predicate: (row) => row.ownerLeaseId === firstOwnerLeaseId && row.clearedAt === null,
        });
        const workflowRuns = await waitForWorkflowRuns({
          env,
          sandboxInstanceId,
          minimumCount: 3,
        });

        expect(staleDisconnectDeadline.generation).toBe(1);
        expectWorkflowRunMatchesDeadline({
          workflowRun: workflowRuns[2]!,
          sandboxInstanceId,
          kind: "idle",
          ownerLeaseId: secondOwnerLeaseId,
          generation: replacementIdleDeadline.generation,
          dueAt: canonicalizeIsoString(replacementIdleDeadline.dueAt),
        });
      } finally {
        await closeIfOpen(secondBootstrapSocket);
      }
    },
    TestTimeoutMs,
  );

  it(
    "replaces the idle deadline row when the active bootstrap session changes",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
        testId: "gateway_deadline_owner_replacement",
      });

      const firstBootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const firstRuntimeState = await waitForRuntimeState({
        env,
        sandboxInstanceId,
        predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
      });
      const firstOwnerLeaseId = readOwnerLeaseId(firstRuntimeState);
      await waitForDeadlineRow({
        env,
        sandboxInstanceId,
        kind: "idle",
        predicate: (row) =>
          row.ownerLeaseId === firstOwnerLeaseId && row.generation === 1 && row.clearedAt === null,
      });

      const firstBootstrapClose = waitForWebSocketClose(firstBootstrapSocket);
      const secondBootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });

      try {
        const secondRuntimeState = await waitForRuntimeState({
          env,
          sandboxInstanceId,
          predicate: (snapshot) =>
            snapshot.ownerLeaseId !== null &&
            snapshot.ownerLeaseId !== firstOwnerLeaseId &&
            snapshot.attachment !== null,
        });
        const secondOwnerLeaseId = readOwnerLeaseId(secondRuntimeState);
        const replacedIdleDeadline = await waitForDeadlineRow({
          env,
          sandboxInstanceId,
          kind: "idle",
          predicate: (row) =>
            row.ownerLeaseId === secondOwnerLeaseId &&
            row.generation === 2 &&
            row.clearedAt === null,
        });
        const workflowRuns = await waitForWorkflowRuns({
          env,
          sandboxInstanceId,
          minimumCount: 2,
        });

        expect((await firstBootstrapClose).code).toBe(1012);
        expectWorkflowRunMatchesDeadline({
          workflowRun: workflowRuns[1]!,
          sandboxInstanceId,
          kind: "idle",
          ownerLeaseId: secondOwnerLeaseId,
          generation: replacedIdleDeadline.generation,
          dueAt: canonicalizeIsoString(replacedIdleDeadline.dueAt),
        });
      } finally {
        await closeIfOpen(secondBootstrapSocket);
      }
    },
    TestTimeoutMs,
  );

  it(
    "reschedules idle when the bootstrap peer reports active keepalive",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
        testId: "gateway_deadline_keepalive_touch",
      });

      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });

      try {
        const runtimeState = await waitForRuntimeState({
          env,
          sandboxInstanceId,
          predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
        });
        const ownerLeaseId = readOwnerLeaseId(runtimeState);
        await waitForDeadlineRow({
          env,
          sandboxInstanceId,
          kind: "idle",
          predicate: (row) =>
            row.ownerLeaseId === ownerLeaseId && row.generation === 1 && row.clearedAt === null,
        });

        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "keepalive.state",
            ttlMs: 30_000,
            active: true,
          }),
        );

        const rescheduledIdleDeadline = await waitForDeadlineRow({
          env,
          sandboxInstanceId,
          kind: "idle",
          predicate: (row) =>
            row.ownerLeaseId === ownerLeaseId && row.generation === 2 && row.clearedAt === null,
        });
        const workflowRuns = await waitForWorkflowRuns({
          env,
          sandboxInstanceId,
          minimumCount: 2,
        });

        expectWorkflowRunMatchesDeadline({
          workflowRun: workflowRuns[1]!,
          sandboxInstanceId,
          kind: "idle",
          ownerLeaseId,
          generation: rescheduledIdleDeadline.generation,
          dueAt: canonicalizeIsoString(rescheduledIdleDeadline.dueAt),
        });
      } finally {
        await closeIfOpen(bootstrapSocket);
      }
    },
    TestTimeoutMs,
  );

  it(
    "clears idle and schedules disconnect when the bootstrap peer disconnects",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
        testId: "gateway_deadline_bootstrap_disconnect",
      });

      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const runtimeState = await waitForRuntimeState({
        env,
        sandboxInstanceId,
        predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
      });
      const ownerLeaseId = readOwnerLeaseId(runtimeState);
      await waitForDeadlineRow({
        env,
        sandboxInstanceId,
        kind: "idle",
        predicate: (row) =>
          row.ownerLeaseId === ownerLeaseId && row.generation === 1 && row.clearedAt === null,
      });

      await closeWebSocket(bootstrapSocket);

      await waitForRuntimeState({
        env,
        sandboxInstanceId,
        predicate: (snapshot) => snapshot.ownerLeaseId === null && snapshot.attachment === null,
      });
      const clearedIdleDeadline = await waitForDeadlineRow({
        env,
        sandboxInstanceId,
        kind: "idle",
        predicate: (row) => row.ownerLeaseId === ownerLeaseId && row.clearedAt !== null,
      });
      const disconnectDeadline = await waitForDeadlineRow({
        env,
        sandboxInstanceId,
        kind: "disconnect",
        predicate: (row) =>
          row.ownerLeaseId === ownerLeaseId && row.generation === 1 && row.clearedAt === null,
      });
      const workflowRuns = await waitForWorkflowRuns({
        env,
        sandboxInstanceId,
        minimumCount: 2,
      });

      expect(clearedIdleDeadline.clearedAt).toEqual(expect.any(String));
      expectWorkflowRunMatchesDeadline({
        workflowRun: workflowRuns[1]!,
        sandboxInstanceId,
        kind: "disconnect",
        ownerLeaseId,
        generation: disconnectDeadline.generation,
        dueAt: canonicalizeIsoString(disconnectDeadline.dueAt),
      });
    },
    TestTimeoutMs,
  );
});

async function insertSandboxInstanceRow(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
  testId: string;
}): Promise<void> {
  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: `org_${input.testId}`,
    sandboxProfileId: `sbp_${input.testId}`,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: `workflow_${input.testId}`,
    source: "webhook",
  });
}

async function connectBootstrapSocket(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<WebSocket> {
  return connectSandboxTunnelWebSocket({
    websocketBaseUrl: createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl),
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: "bootstrap",
    token: await mintBootstrapToken({
      config: {
        bootstrapTokenSecret: BootstrapTokenSecret,
        tokenIssuer: BootstrapTokenIssuer,
        tokenAudience: GatewayTokenAudience,
      },
      jti: randomUUID(),
      sandboxInstanceId: input.sandboxInstanceId,
      ttlSeconds: 120,
    }),
    headers: {
      [TestEnvironmentIdHeader]: input.env.id,
    },
  });
}

async function connectConnectionSocket(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<WebSocket> {
  return connectSandboxTunnelWebSocket({
    websocketBaseUrl: createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl),
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: "connect",
    token: await mintConnectionToken({
      config: {
        connectionTokenSecret: ConnectionTokenSecret,
        tokenIssuer: ConnectionTokenIssuer,
        tokenAudience: GatewayTokenAudience,
      },
      jti: randomUUID(),
      sandboxInstanceId: input.sandboxInstanceId,
      ttlSeconds: 120,
    }),
    headers: {
      [TestEnvironmentIdHeader]: input.env.id,
    },
  });
}

async function waitForDeadlineRow(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
  kind: DeadlineKind;
  predicate: (row: DeadlineRow) => boolean;
}): Promise<DeadlineRow> {
  const deadlineMs = systemClock.nowMs() + DeadlineWaitTimeoutMs;

  while (systemClock.nowMs() < deadlineMs) {
    const row = await input.env.dataPlaneDb.query.sandboxInstanceDeadlines.findFirst({
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
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
  minimumCount: number;
}): Promise<WorkflowRunRow[]> {
  const deadline = systemClock.nowMs() + WorkflowQueueWaitTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    const workflowRuns = await listDeadlineWorkflowRuns(input.env, input.sandboxInstanceId);
    if (workflowRuns.length >= input.minimumCount) {
      return workflowRuns;
    }

    await systemSleeper.sleep(WorkflowQueuePollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued deadline workflow runs for sandbox '${input.sandboxInstanceId}'.`,
  );
}

async function listDeadlineWorkflowRuns(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
): Promise<WorkflowRunRow[]> {
  const namespaceId = createDataPlaneWorkflowNamespaceId(env.id);
  const result = await env.dataPlaneDb.execute(sql<WorkflowRunRow>`
    select id, workflow_name, status, input, available_at, idempotency_key
    from data_plane_openworkflow.workflow_runs
    where
      namespace_id = ${namespaceId}
      and workflow_name = ${DeadlineWorkflowName}
      and input->>'sandboxInstanceId' = ${sandboxInstanceId}
    order by created_at asc
  `);

  return result.rows;
}

function expectWorkflowRunMatchesDeadline(input: {
  workflowRun: WorkflowRunRow;
  sandboxInstanceId: string;
  kind: DeadlineKind;
  ownerLeaseId: string;
  generation: number;
  dueAt: string;
}): void {
  expect(input.workflowRun.workflow_name).toBe(DeadlineWorkflowName);
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

async function readRuntimeState(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<SandboxRuntimeStateSnapshot> {
  const response = await input.env.dataPlaneGateway.http.fetch(
    `/internal/sandbox-instances/${encodeURIComponent(input.sandboxInstanceId)}/runtime-state`,
    {
      headers: {
        [InternalServiceTokenHeader]: "integration-new-internal-service-token",
      },
    },
  );

  expect(response.status).toBe(200);
  return SandboxRuntimeStateSnapshotSchema.parse(await response.json());
}

async function waitForRuntimeState(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
  predicate: (snapshot: SandboxRuntimeStateSnapshot) => boolean;
}): Promise<SandboxRuntimeStateSnapshot> {
  const deadline = systemClock.nowMs() + RuntimeStateReadTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    const snapshot = await readRuntimeState({
      env: input.env,
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (input.predicate(snapshot)) {
      return snapshot;
    }

    await systemSleeper.sleep(RuntimeStateReadPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for runtime-state snapshot for sandbox '${input.sandboxInstanceId}'.`,
  );
}

function readOwnerLeaseId(snapshot: SandboxRuntimeStateSnapshot): string {
  if (snapshot.ownerLeaseId === null) {
    throw new Error("Expected runtime state to include an owner lease id.");
  }

  return snapshot.ownerLeaseId;
}

async function closeIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (
    socket === undefined ||
    socket.readyState === WebSocket.CLOSED ||
    socket.readyState === WebSocket.CLOSING
  ) {
    return;
  }

  await closeWebSocket(socket);
}

function canonicalizeIsoString(value: string): string {
  return new Date(value).toISOString();
}

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}
