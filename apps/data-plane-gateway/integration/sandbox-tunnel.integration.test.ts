/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses, sandboxInstances } from "@mistle/db/data-plane";
import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import { systemSleeper } from "@mistle/time";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";

import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";
import {
  closeWebSocket,
  connectWebSocket,
  connectWebSocketExpectFailure,
  waitForWebSocketClose,
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
    activeTunnelLeaseId: null,
    tunnelConnectedAt: null,
    lastTunnelSeenAt: null,
    tunnelDisconnectedAt: "2026-03-13T00:00:00.000Z",
  });
}

async function waitForSandboxInstanceProjection(
  input: DataPlaneGatewayIntegrationFixture & {
    sandboxInstanceId: string;
    predicate: (sandboxInstance: {
      activeTunnelLeaseId: string | null;
      tunnelConnectedAt: string | null;
      lastTunnelSeenAt: string | null;
      tunnelDisconnectedAt: string | null;
    }) => boolean;
  },
): Promise<{
  activeTunnelLeaseId: string | null;
  tunnelConnectedAt: string | null;
  lastTunnelSeenAt: string | null;
  tunnelDisconnectedAt: string | null;
}> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const sandboxInstance = await input.db.query.sandboxInstances.findFirst({
      columns: {
        activeTunnelLeaseId: true,
        tunnelConnectedAt: true,
        lastTunnelSeenAt: true,
        tunnelDisconnectedAt: true,
      },
      where: (table, { eq }) => eq(table.id, input.sandboxInstanceId),
    });

    if (sandboxInstance !== undefined && input.predicate(sandboxInstance)) {
      return sandboxInstance;
    }

    await systemSleeper.sleep(50);
  }

  throw new Error(
    `Timed out waiting for sandbox tunnel projection for instance '${input.sandboxInstanceId}'.`,
  );
}

describe("sandbox tunnel connect endpoint integration", () => {
  it(
    "accepts a valid bootstrap token and records exactly one token redemption",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const jti = randomUUID();
      const token = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti,
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const socket = await connectWebSocket(
        `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(token)}`,
      );

      const recordedRedemption = await fixture.db.query.sandboxTunnelTokenRedemptions.findFirst({
        where: (table, { eq }) => eq(table.tokenJti, jti),
      });
      const sandboxInstance = await waitForSandboxInstanceProjection({
        ...fixture,
        sandboxInstanceId,
        predicate: (currentSandboxInstance) =>
          currentSandboxInstance.activeTunnelLeaseId !== null &&
          currentSandboxInstance.tunnelConnectedAt !== null &&
          currentSandboxInstance.lastTunnelSeenAt !== null &&
          currentSandboxInstance.tunnelDisconnectedAt === null,
      });

      expect(sandboxInstance?.activeTunnelLeaseId).not.toBeNull();
      expect(recordedRedemption?.tokenJti).toBe(jti);
      expect(sandboxInstance?.tunnelConnectedAt).not.toBeNull();
      expect(sandboxInstance?.lastTunnelSeenAt).not.toBeNull();
      expect(sandboxInstance?.tunnelDisconnectedAt).toBeNull();

      await closeWebSocket(socket);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "accepts a valid connection token and records exactly one token redemption",
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
      const jti = randomUUID();
      const token = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti,
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const bootstrapSocket = await connectWebSocket(
        `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
      );
      const socket = await connectWebSocket(
        `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(token)}`,
      );

      const recordedRedemption = await fixture.db.query.sandboxTunnelTokenRedemptions.findFirst({
        where: (table, { eq }) => eq(table.tokenJti, jti),
      });

      expect(recordedRedemption?.tokenJti).toBe(jti);

      await closeWebSocket(socket);
      await closeWebSocket(bootstrapSocket);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "records tunnel disconnection when the bootstrap socket closes",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const token = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const socket = await connectWebSocket(
        `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(token)}`,
      );

      await closeWebSocket(socket);

      const sandboxInstance = await waitForSandboxInstanceProjection({
        ...fixture,
        sandboxInstanceId,
        predicate: (currentSandboxInstance) => currentSandboxInstance.tunnelDisconnectedAt !== null,
      });

      expect(sandboxInstance?.tunnelDisconnectedAt).not.toBeNull();
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "does not mark the sandbox disconnected when a replaced bootstrap socket closes after a newer lease connects",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const firstToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const secondToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      const firstSocket = await connectWebSocket(
        `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(firstToken)}`,
      );
      const firstConnectedProjection = await waitForSandboxInstanceProjection({
        ...fixture,
        sandboxInstanceId,
        predicate: (currentSandboxInstance) => currentSandboxInstance.activeTunnelLeaseId !== null,
      });
      const firstActiveTunnelLeaseId = firstConnectedProjection.activeTunnelLeaseId;
      if (firstActiveTunnelLeaseId === null) {
        throw new Error(
          "Expected the first bootstrap connection to persist an active tunnel lease id.",
        );
      }

      const firstSocketClosePromise = waitForWebSocketClose(firstSocket);
      const secondSocket = await connectWebSocket(
        `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(secondToken)}`,
      );
      const secondConnectedProjection = await waitForSandboxInstanceProjection({
        ...fixture,
        sandboxInstanceId,
        predicate: (currentSandboxInstance) =>
          currentSandboxInstance.activeTunnelLeaseId !== null &&
          currentSandboxInstance.activeTunnelLeaseId !== firstActiveTunnelLeaseId &&
          currentSandboxInstance.tunnelDisconnectedAt === null,
      });

      expect(secondConnectedProjection.activeTunnelLeaseId).not.toBe(firstActiveTunnelLeaseId);

      const firstSocketClose = await firstSocketClosePromise;
      expect(firstSocketClose.code).toBe(1012);

      const projectionAfterStaleClose = await waitForSandboxInstanceProjection({
        ...fixture,
        sandboxInstanceId,
        predicate: (currentSandboxInstance) =>
          currentSandboxInstance.activeTunnelLeaseId ===
          secondConnectedProjection.activeTunnelLeaseId,
      });

      expect(projectionAfterStaleClose.activeTunnelLeaseId).toBe(
        secondConnectedProjection.activeTunnelLeaseId,
      );
      expect(projectionAfterStaleClose.tunnelDisconnectedAt).toBeNull();

      await closeWebSocket(secondSocket);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "rejects connection tokens when no bootstrap owner is connected and does not record an ack",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const jti = randomUUID();
      const token = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti,
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      const failedConnect = await connectWebSocketExpectFailure(
        `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(token)}`,
      );
      const recordedRedemption = await fixture.db.query.sandboxTunnelTokenRedemptions.findFirst({
        where: (table, { eq }) => eq(table.tokenJti, jti),
      });

      expect(failedConnect.error).toBeInstanceOf(Error);
      expect(failedConnect.responseStatusCode).toBe(409);
      expect(recordedRedemption).toBeUndefined();
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "rejects requests that include both bootstrap and connection token query params",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
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

      const failedConnect = await connectWebSocketExpectFailure(
        `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}&connect_token=${encodeURIComponent(connectionToken)}`,
      );

      expect(failedConnect.error).toBeInstanceOf(Error);
      expect(failedConnect.responseStatusCode).toBe(400);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "rejects reconnect attempts that reuse a redeemed bootstrap token",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const jti = randomUUID();
      const token = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti,
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const socket = await connectWebSocket(
        `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(token)}`,
      );
      await closeWebSocket(socket);

      const failedConnect = await connectWebSocketExpectFailure(
        `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(token)}`,
      );
      const recordedRedemptions = await fixture.db.query.sandboxTunnelTokenRedemptions.findMany({
        where: (table, { eq }) => eq(table.tokenJti, jti),
      });

      expect(failedConnect.error).toBeInstanceOf(Error);
      expect(failedConnect.responseStatusCode).toBe(409);
      expect(recordedRedemptions).toHaveLength(1);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "rejects reconnect attempts that reuse a redeemed connection token",
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
      const jti = randomUUID();
      const token = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti,
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const bootstrapSocket = await connectWebSocket(
        `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
      );
      const socket = await connectWebSocket(
        `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(token)}`,
      );
      await closeWebSocket(socket);

      const failedConnect = await connectWebSocketExpectFailure(
        `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(token)}`,
      );
      const recordedRedemptions = await fixture.db.query.sandboxTunnelTokenRedemptions.findMany({
        where: (table, { eq }) => eq(table.tokenJti, jti),
      });

      expect(failedConnect.error).toBeInstanceOf(Error);
      expect(failedConnect.responseStatusCode).toBe(409);
      expect(recordedRedemptions).toHaveLength(1);
      await closeWebSocket(bootstrapSocket);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "rejects token requests when path instance id does not match token sandboxInstanceId claim",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const otherSandboxInstanceId = typeid("sbi").toString();
      const token = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      const failedConnect = await connectWebSocketExpectFailure(
        `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(otherSandboxInstanceId)}?connect_token=${encodeURIComponent(token)}`,
      );

      expect(failedConnect.error).toBeInstanceOf(Error);
      expect(failedConnect.responseStatusCode).toBe(401);
    },
    IntegrationTestTimeoutMs,
  );
});
