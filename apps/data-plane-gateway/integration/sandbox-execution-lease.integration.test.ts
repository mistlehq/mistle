/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses, sandboxInstances } from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import { systemSleeper } from "@mistle/time";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";
import WebSocket from "ws";

import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";
import {
  closeWebSocket,
  connectWebSocket,
  sendWebSocketMessage,
  sendWebSocketPingAndExpectPong,
  waitForNoWebSocketMessage,
} from "./websocket-test-helpers.js";

const IntegrationTestTimeoutMs = 30_000;

async function insertSandboxInstanceRow(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.fixture.db.insert(sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_data_plane_gateway_integration",
    sandboxProfileId: "sbp_data_plane_gateway_integration",
    sandboxProfileVersion: 1,
    runtimeProvider: input.fixture.config.sandbox.provider,
    providerRuntimeId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_data_plane_gateway_integration",
    source: "webhook",
    activeTunnelLeaseId: null,
    tunnelConnectedAt: null,
    lastTunnelSeenAt: null,
    tunnelDisconnectedAt: "2026-03-13T00:00:00.000Z",
  });
}

async function waitForExecutionLeaseRow(
  input: DataPlaneGatewayIntegrationFixture & {
    leaseId: string;
    predicate: (lease: {
      externalExecutionId: string | null;
      id: string;
      kind: string;
      lastSeenAt: string;
      metadata: Record<string, unknown> | null;
      openedAt: string;
      sandboxInstanceId: string;
      source: string;
    }) => boolean;
  },
): Promise<{
  externalExecutionId: string | null;
  id: string;
  kind: string;
  lastSeenAt: string;
  metadata: Record<string, unknown> | null;
  openedAt: string;
  sandboxInstanceId: string;
  source: string;
}> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const lease = await input.db.query.sandboxExecutionLeases.findFirst({
      columns: {
        id: true,
        sandboxInstanceId: true,
        kind: true,
        source: true,
        externalExecutionId: true,
        metadata: true,
        openedAt: true,
        lastSeenAt: true,
      },
      where: (table, { eq }) => eq(table.id, input.leaseId),
    });

    if (lease !== undefined && input.predicate(lease)) {
      return lease;
    }

    await systemSleeper.sleep(50);
  }

  throw new Error(`Timed out waiting for execution lease '${input.leaseId}'.`);
}

async function closeWebSocketIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}

describe("sandbox execution lease integration", () => {
  it(
    "persists bootstrap lease create and renew messages",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const leaseId = typeid("sxl").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );

        const noCreateResponse = waitForNoWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "lease.create",
            lease: {
              id: leaseId,
              kind: "agent_execution",
              source: "codex",
              externalExecutionId: "turn_123",
              metadata: {
                threadId: "thr_123",
              },
            },
          }),
        );
        await noCreateResponse;

        const createdLease = await waitForExecutionLeaseRow({
          ...fixture,
          leaseId,
          predicate: (lease) =>
            lease.kind === "agent_execution" &&
            lease.source === "codex" &&
            lease.externalExecutionId === "turn_123" &&
            lease.openedAt === lease.lastSeenAt,
        });

        await systemSleeper.sleep(50);

        const noRenewResponse = waitForNoWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "lease.renew",
            leaseId,
          }),
        );
        await noRenewResponse;

        const renewedLease = await waitForExecutionLeaseRow({
          ...fixture,
          leaseId,
          predicate: (lease) => lease.lastSeenAt > createdLease.lastSeenAt,
        });

        expect(renewedLease).toEqual({
          id: leaseId,
          sandboxInstanceId,
          kind: "agent_execution",
          source: "codex",
          externalExecutionId: "turn_123",
          metadata: {
            threadId: "thr_123",
          },
          openedAt: createdLease.openedAt,
          lastSeenAt: renewedLease.lastSeenAt,
        });
      } finally {
        await closeWebSocketIfOpen(bootstrapSocket);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "keeps the bootstrap websocket open when renewing an unknown execution lease",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      const bootstrapSocket = await connectWebSocket(
        `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
      );

      try {
        const noResponsePromise = waitForNoWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "lease.renew",
            leaseId: "sxl_missing",
          }),
        );

        await noResponsePromise;
        await sendWebSocketPingAndExpectPong(bootstrapSocket, Buffer.from("lease-renew-miss"));

        const missingLease = await fixture.db.query.sandboxExecutionLeases.findFirst({
          where: (table, { eq }) => eq(table.id, "sxl_missing"),
        });

        expect(missingLease).toBeUndefined();
      } finally {
        if (bootstrapSocket.readyState === WebSocket.OPEN) {
          await closeWebSocket(bootstrapSocket);
        }
      }
    },
    IntegrationTestTimeoutMs,
  );
});
