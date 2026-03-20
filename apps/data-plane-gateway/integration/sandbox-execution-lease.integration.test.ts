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

import { ValkeySandboxActivityStore } from "../src/runtime-state/adapters/valkey-sandbox-activity-store.js";
import { closeValkeyClient, createValkeyClient } from "../src/runtime-state/valkey-client.js";
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

async function waitForActiveActivityLease(input: {
  store: ValkeySandboxActivityStore;
  sandboxInstanceId: string;
}): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const hasAnyActiveLease = await input.store.hasAnyActiveLease({
      sandboxInstanceId: input.sandboxInstanceId,
      nowMs: Date.now(),
    });
    if (hasAnyActiveLease) {
      return;
    }

    await systemSleeper.sleep(50);
  }

  throw new Error(`Timed out waiting for activity lease for sandbox '${input.sandboxInstanceId}'.`);
}

async function createActivityStore(fixture: DataPlaneGatewayIntegrationFixture): Promise<{
  client: ReturnType<typeof createValkeyClient>;
  store: ValkeySandboxActivityStore;
}> {
  if (fixture.config.app.runtimeState.backend !== "valkey") {
    throw new Error("Expected Valkey runtime-state backend for sandbox activity integration test.");
  }
  const valkeyConfig = fixture.config.app.runtimeState.valkey;
  if (valkeyConfig === undefined) {
    throw new Error("Expected runtimeState.valkey config for sandbox activity integration test.");
  }

  const client = createValkeyClient({
    url: valkeyConfig.url,
  });
  await client.connect();

  return {
    client,
    store: new ValkeySandboxActivityStore(client, valkeyConfig.keyPrefix),
  };
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
      const { client, store } = await createActivityStore(fixture);
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

        await waitForActiveActivityLease({
          store,
          sandboxInstanceId,
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

        await waitForActiveActivityLease({
          store,
          sandboxInstanceId,
        });

        const executionLeaseRow = await fixture.db.query.sandboxExecutionLeases.findFirst({
          where: (table, { eq }) => eq(table.id, leaseId),
        });
        expect(executionLeaseRow).toBeUndefined();
      } finally {
        await closeValkeyClient(client);
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
      const { client, store } = await createActivityStore(fixture);
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

        await expect(
          store.hasAnyActiveLease({
            sandboxInstanceId,
            nowMs: Date.now(),
          }),
        ).resolves.toBe(false);

        const missingLease = await fixture.db.query.sandboxExecutionLeases.findFirst({
          where: (table, { eq }) => eq(table.id, "sxl_missing"),
        });

        expect(missingLease).toBeUndefined();
      } finally {
        await closeValkeyClient(client);
        if (bootstrapSocket.readyState === WebSocket.OPEN) {
          await closeWebSocket(bootstrapSocket);
        }
      }
    },
    IntegrationTestTimeoutMs,
  );
});
