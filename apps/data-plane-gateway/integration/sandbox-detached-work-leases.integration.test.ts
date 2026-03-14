/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { randomUUID } from "node:crypto";

import {
  SandboxInstanceStatuses,
  sandboxDetachedWorkLeases,
  sandboxInstances,
} from "@mistle/db/data-plane";
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
    provider: input.fixture.config.sandbox.provider,
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_data_plane_gateway_integration",
    source: "webhook",
    tunnelConnectedAt: null,
    lastTunnelSeenAt: null,
    tunnelDisconnectedAt: "2026-03-13T00:00:00.000Z",
  });
}

async function closeWebSocketIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}

async function waitForDetachedWorkLease(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  leaseId: string;
  predicate: (lease: {
    externalExecutionId: string | null;
    kind: string;
    lastSeenAt: string;
    openedAt: string;
    protocolFamily: string;
    sandboxInstanceId: string;
  }) => boolean;
}): Promise<{
  externalExecutionId: string | null;
  kind: string;
  lastSeenAt: string;
  openedAt: string;
  protocolFamily: string;
  sandboxInstanceId: string;
}> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const lease = await input.fixture.db.query.sandboxDetachedWorkLeases.findFirst({
      columns: {
        externalExecutionId: true,
        kind: true,
        lastSeenAt: true,
        openedAt: true,
        protocolFamily: true,
        sandboxInstanceId: true,
      },
      where: (table, { eq }) => eq(table.leaseId, input.leaseId),
    });

    if (lease !== undefined && input.predicate(lease)) {
      return lease;
    }

    await systemSleeper.sleep(25);
  }

  throw new Error(`Timed out waiting for detached work lease '${input.leaseId}'.`);
}

describe("sandbox detached work lease persistence integration", () => {
  it(
    "persists bootstrap detached-work lease open and renew observations",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const leaseId = "agent_turn:turn_123";
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

        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "detached_work.lease.open",
            leaseId,
            kind: "agent_turn",
            protocolFamily: "codex-json-rpc",
            externalExecutionId: "turn_123",
          }),
        );

        const openedLease = await waitForDetachedWorkLease({
          fixture,
          leaseId,
          predicate: (lease) =>
            lease.sandboxInstanceId === sandboxInstanceId &&
            lease.kind === "agent_turn" &&
            lease.protocolFamily === "codex-json-rpc" &&
            lease.externalExecutionId === "turn_123",
        });

        await systemSleeper.sleep(25);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "detached_work.lease.renew",
            leaseId,
            kind: "agent_turn",
            protocolFamily: "codex-json-rpc",
          }),
        );

        const renewedLease = await waitForDetachedWorkLease({
          fixture,
          leaseId,
          predicate: (lease) => Date.parse(lease.lastSeenAt) > Date.parse(openedLease.lastSeenAt),
        });

        expect(renewedLease.sandboxInstanceId).toBe(sandboxInstanceId);
        expect(renewedLease.kind).toBe("agent_turn");
        expect(renewedLease.protocolFamily).toBe("codex-json-rpc");
        expect(renewedLease.externalExecutionId).toBe("turn_123");
        expect(Date.parse(renewedLease.openedAt)).toBe(Date.parse(openedLease.openedAt));

        const leaseRows = await fixture.db
          .select({
            leaseId: sandboxDetachedWorkLeases.leaseId,
          })
          .from(sandboxDetachedWorkLeases);
        expect(leaseRows).toEqual([{ leaseId }]);
      } finally {
        await closeWebSocketIfOpen(bootstrapSocket);
      }
    },
    IntegrationTestTimeoutMs,
  );
});
