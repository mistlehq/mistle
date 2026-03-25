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
import { z } from "zod";

import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";
import {
  closeWebSocket,
  connectWebSocket,
  connectWebSocketExpectFailure,
  waitForWebSocketClose,
} from "./websocket-test-helpers.js";

const IntegrationTestTimeoutMs = 30_000;
const InternalServiceTokenHeader = "x-mistle-service-token";

type RuntimeStateSnapshot = {
  ownerLeaseId: string | null;
  attachment: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
    nodeId: string;
    sessionId: string;
    attachedAtMs: number;
  } | null;
};

const RuntimeStateSnapshotSchema = z
  .object({
    ownerLeaseId: z.string().min(1).nullable(),
    attachment: z
      .object({
        sandboxInstanceId: z.string().min(1),
        ownerLeaseId: z.string().min(1),
        nodeId: z.string().min(1),
        sessionId: z.string().min(1),
        attachedAtMs: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict();

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
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_data_plane_gateway_integration",
    source: "webhook",
  });
}

async function readRuntimeState(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
}): Promise<RuntimeStateSnapshot> {
  const response = await fetch(
    `${input.fixture.baseUrl}/internal/sandbox-instances/${encodeURIComponent(input.sandboxInstanceId)}/runtime-state`,
    {
      headers: {
        [InternalServiceTokenHeader]: input.fixture.config.internalAuth.serviceToken,
      },
    },
  );

  expect(response.status).toBe(200);
  return RuntimeStateSnapshotSchema.parse(await response.json());
}

async function waitForRuntimeState(
  input: DataPlaneGatewayIntegrationFixture & {
    sandboxInstanceId: string;
    predicate: (snapshot: RuntimeStateSnapshot) => boolean;
  },
): Promise<RuntimeStateSnapshot> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const snapshot = await readRuntimeState({
      fixture: input,
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (input.predicate(snapshot)) {
      return snapshot;
    }

    await systemSleeper.sleep(50);
  }

  throw new Error(
    `Timed out waiting for runtime-state snapshot for sandbox '${input.sandboxInstanceId}'.`,
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
      const sandboxRuntimeState = await waitForRuntimeState({
        ...fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId !== null && currentSnapshot.attachment !== null,
      });

      expect(sandboxRuntimeState.ownerLeaseId).not.toBeNull();
      expect(sandboxRuntimeState.attachment).not.toBeNull();
      expect(recordedRedemption?.tokenJti).toBe(jti);
      expect(sandboxRuntimeState.attachment?.ownerLeaseId).toBe(sandboxRuntimeState.ownerLeaseId);
      expect(sandboxRuntimeState.attachment?.sandboxInstanceId).toBe(sandboxInstanceId);

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

      const sandboxRuntimeState = await waitForRuntimeState({
        ...fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId === null && currentSnapshot.attachment === null,
      });

      expect(sandboxRuntimeState).toEqual({
        ownerLeaseId: null,
        attachment: null,
      });
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
      const firstConnectedSnapshot = await waitForRuntimeState({
        ...fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId !== null && currentSnapshot.attachment !== null,
      });
      const firstOwnerLeaseId = firstConnectedSnapshot.ownerLeaseId;
      if (firstOwnerLeaseId === null) {
        throw new Error("Expected the first bootstrap connection to persist an owner lease id.");
      }

      const firstSocketClosePromise = waitForWebSocketClose(firstSocket);
      const secondSocket = await connectWebSocket(
        `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(secondToken)}`,
      );
      const secondConnectedSnapshot = await waitForRuntimeState({
        ...fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId !== null &&
          currentSnapshot.ownerLeaseId !== firstOwnerLeaseId &&
          currentSnapshot.attachment !== null,
      });

      expect(secondConnectedSnapshot.ownerLeaseId).not.toBe(firstOwnerLeaseId);
      expect(secondConnectedSnapshot.attachment?.ownerLeaseId).toBe(
        secondConnectedSnapshot.ownerLeaseId,
      );

      const firstSocketClose = await firstSocketClosePromise;
      expect(firstSocketClose.code).toBe(1012);

      const snapshotAfterStaleClose = await waitForRuntimeState({
        ...fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId === secondConnectedSnapshot.ownerLeaseId &&
          currentSnapshot.attachment?.ownerLeaseId === secondConnectedSnapshot.ownerLeaseId,
      });

      expect(snapshotAfterStaleClose.ownerLeaseId).toBe(secondConnectedSnapshot.ownerLeaseId);
      expect(snapshotAfterStaleClose.attachment?.ownerLeaseId).toBe(
        secondConnectedSnapshot.ownerLeaseId,
      );

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
