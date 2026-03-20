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
import WebSocket from "ws";

import { ValkeySandboxPresenceStore } from "../src/runtime-state/adapters/valkey-sandbox-presence-store.js";
import { PRESENCE_LEASE_TTL_MS } from "../src/runtime-state/durations.js";
import { closeValkeyClient, createValkeyClient } from "../src/runtime-state/valkey-client.js";
import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";
import { closeWebSocket, waitForWebSocketClose } from "./websocket-test-helpers.js";

const IntegrationTestTimeoutMs = 60_000;

async function insertSandboxInstanceRow(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.fixture.db.insert(sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_sandbox_presence_it",
    sandboxProfileId: "sbp_sandbox_presence_it",
    sandboxProfileVersion: 1,
    runtimeProvider: input.fixture.config.sandbox.provider,
    providerRuntimeId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_sandbox_presence_it",
    source: "webhook",
    activeTunnelLeaseId: null,
    tunnelConnectedAt: null,
    lastTunnelSeenAt: null,
    tunnelDisconnectedAt: "2026-03-13T00:00:00.000Z",
  });
}

async function mintValidBootstrapToken(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
}): Promise<string> {
  return mintBootstrapToken({
    config: {
      bootstrapTokenSecret: input.fixture.config.sandbox.bootstrap.tokenSecret,
      tokenIssuer: input.fixture.config.sandbox.bootstrap.tokenIssuer,
      tokenAudience: input.fixture.config.sandbox.bootstrap.tokenAudience,
    },
    jti: randomUUID(),
    sandboxInstanceId: input.sandboxInstanceId,
    ttlSeconds: 120,
  });
}

async function mintValidConnectionToken(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
}): Promise<string> {
  return mintConnectionToken({
    config: {
      connectionTokenSecret: input.fixture.config.sandbox.connect.tokenSecret,
      tokenIssuer: input.fixture.config.sandbox.connect.tokenIssuer,
      tokenAudience: input.fixture.config.sandbox.connect.tokenAudience,
    },
    jti: randomUUID(),
    sandboxInstanceId: input.sandboxInstanceId,
    ttlSeconds: 120,
  });
}

function connectBootstrapSocket(input: {
  autoPong?: boolean;
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
  token: string;
}): Promise<WebSocket> {
  return connectTunnelSocket(
    input.autoPong === undefined
      ? {
          fixture: input.fixture,
          sandboxInstanceId: input.sandboxInstanceId,
          tokenKind: "bootstrap",
          token: input.token,
        }
      : {
          autoPong: input.autoPong,
          fixture: input.fixture,
          sandboxInstanceId: input.sandboxInstanceId,
          tokenKind: "bootstrap",
          token: input.token,
        },
  );
}

function connectConnectionSocket(input: {
  autoPong?: boolean;
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
  token: string;
}): Promise<WebSocket> {
  return connectTunnelSocket(
    input.autoPong === undefined
      ? {
          fixture: input.fixture,
          sandboxInstanceId: input.sandboxInstanceId,
          tokenKind: "connect",
          token: input.token,
        }
      : {
          autoPong: input.autoPong,
          fixture: input.fixture,
          sandboxInstanceId: input.sandboxInstanceId,
          tokenKind: "connect",
          token: input.token,
        },
  );
}

function connectTunnelSocket(input: {
  autoPong?: boolean;
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
  token: string;
  tokenKind: "bootstrap" | "connect";
}): Promise<WebSocket> {
  const tokenQueryParam = input.tokenKind === "bootstrap" ? "bootstrap_token" : "connect_token";

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${input.fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(input.sandboxInstanceId)}?${tokenQueryParam}=${encodeURIComponent(input.token)}`,
      input.autoPong === undefined
        ? {
            autoPong: true,
            handshakeTimeout: 4_000,
          }
        : {
            autoPong: input.autoPong,
            handshakeTimeout: 4_000,
          },
    );

    const onOpen = (): void => {
      socket.off("error", onError);
      socket.off("unexpected-response", onUnexpectedResponse);
      resolve(socket);
    };

    const onError = (error: Error): void => {
      socket.off("open", onOpen);
      socket.off("unexpected-response", onUnexpectedResponse);
      reject(error);
    };

    const onUnexpectedResponse = (_request: unknown, response: { statusCode?: number }): void => {
      socket.off("open", onOpen);
      socket.off("error", onError);
      reject(
        Object.assign(new Error("Websocket upgrade failed."), {
          statusCode: response.statusCode,
        }),
      );
    };

    socket.once("open", onOpen);
    socket.once("error", onError);
    socket.once("unexpected-response", onUnexpectedResponse);
  });
}

function createPresenceStoreFixture(input: { fixture: DataPlaneGatewayIntegrationFixture }): {
  client: ReturnType<typeof createValkeyClient>;
  detailKeyForLease: (sandboxInstanceId: string, leaseId: string) => string;
  indexKeyForSandbox: (sandboxInstanceId: string) => string;
  store: ValkeySandboxPresenceStore;
} {
  if (input.fixture.config.app.runtimeState.backend !== "valkey") {
    throw new Error("Sandbox presence integration tests require the valkey runtime-state backend.");
  }

  const valkeyConfig = input.fixture.config.app.runtimeState.valkey;
  if (valkeyConfig === undefined) {
    throw new Error("Expected runtime-state Valkey config for sandbox presence integration tests.");
  }

  const keyPrefix = valkeyConfig.keyPrefix;
  const client = createValkeyClient({
    url: valkeyConfig.url,
  });
  const store = new ValkeySandboxPresenceStore(client, keyPrefix);

  return {
    client,
    detailKeyForLease: (sandboxInstanceId, leaseId) =>
      `${keyPrefix}:sandbox-presence:${sandboxInstanceId}:lease:${leaseId}`,
    indexKeyForSandbox: (sandboxInstanceId) => `${keyPrefix}:sandbox-presence:${sandboxInstanceId}`,
    store,
  };
}

async function waitForPresenceState(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  predicate: (hasActiveLease: boolean) => boolean;
  sandboxInstanceId: string;
  store: ValkeySandboxPresenceStore;
}): Promise<boolean> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const hasActiveLease = await input.store.hasAnyActiveLease({
      sandboxInstanceId: input.sandboxInstanceId,
      nowMs: Date.now(),
    });
    if (input.predicate(hasActiveLease)) {
      return hasActiveLease;
    }

    await systemSleeper.sleep(50);
  }

  throw new Error(`Timed out waiting for sandbox presence state for '${input.sandboxInstanceId}'.`);
}

async function closeSocketIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket === undefined) {
    return;
  }

  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    await closeWebSocket(socket);
  }
}

describe("sandbox presence integration", () => {
  it(
    "tracks presence leases per connected client session and keeps the sandbox active until the last session disconnects",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });

      const { client, detailKeyForLease, indexKeyForSandbox, store } = createPresenceStoreFixture({
        fixture,
      });
      await client.connect();

      let bootstrapSocket: WebSocket | undefined;
      let firstConnectionSocket: WebSocket | undefined;
      let secondConnectionSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({
          fixture,
          sandboxInstanceId,
          token: await mintValidBootstrapToken({
            fixture,
            sandboxInstanceId,
          }),
        });
        firstConnectionSocket = await connectConnectionSocket({
          fixture,
          sandboxInstanceId,
          token: await mintValidConnectionToken({
            fixture,
            sandboxInstanceId,
          }),
        });

        await expect(
          waitForPresenceState({
            fixture,
            predicate: (hasActiveLease) => hasActiveLease,
            sandboxInstanceId,
            store,
          }),
        ).resolves.toBe(true);

        const presenceLeaseIdsAfterFirstAttach = await client.zRange(
          indexKeyForSandbox(sandboxInstanceId),
          0,
          -1,
        );
        expect(presenceLeaseIdsAfterFirstAttach).toHaveLength(1);
        const firstLeaseId = presenceLeaseIdsAfterFirstAttach[0];
        if (firstLeaseId === undefined) {
          throw new Error("Expected exactly one presence lease after the first connection attach.");
        }

        secondConnectionSocket = await connectConnectionSocket({
          fixture,
          sandboxInstanceId,
          token: await mintValidConnectionToken({
            fixture,
            sandboxInstanceId,
          }),
        });

        const firstLeaseTtlMs = await client.pTTL(
          detailKeyForLease(sandboxInstanceId, firstLeaseId),
        );
        expect(firstLeaseTtlMs).toBeGreaterThan(0);
        expect(firstLeaseTtlMs).toBeLessThanOrEqual(PRESENCE_LEASE_TTL_MS);

        const presenceLeaseIdsAfterSecondAttach = await client.zRange(
          indexKeyForSandbox(sandboxInstanceId),
          0,
          -1,
        );
        expect(presenceLeaseIdsAfterSecondAttach).toHaveLength(2);

        await closeWebSocket(firstConnectionSocket);

        await expect(
          waitForPresenceState({
            fixture,
            predicate: (hasActiveLease) => hasActiveLease,
            sandboxInstanceId,
            store,
          }),
        ).resolves.toBe(true);

        const firstLeaseRemoved = await client.exists(
          detailKeyForLease(sandboxInstanceId, firstLeaseId),
        );
        expect(firstLeaseRemoved).toBe(0);

        await expect(
          waitForPresenceState({
            fixture,
            predicate: (hasActiveLease) => hasActiveLease,
            sandboxInstanceId,
            store,
          }),
        ).resolves.toBe(true);

        await closeWebSocket(secondConnectionSocket);

        await expect(
          waitForPresenceState({
            fixture,
            predicate: (hasActiveLease) => !hasActiveLease,
            sandboxInstanceId,
            store,
          }),
        ).resolves.toBe(false);
      } finally {
        await closeSocketIfOpen(firstConnectionSocket);
        await closeSocketIfOpen(secondConnectionSocket);
        await closeSocketIfOpen(bootstrapSocket);
        await closeValkeyClient(client);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "closes an unresponsive connection websocket and releases its presence lease",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });

      const { client, store } = createPresenceStoreFixture({ fixture });
      await client.connect();

      let bootstrapSocket: WebSocket | undefined;
      let connectionSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({
          fixture,
          sandboxInstanceId,
          token: await mintValidBootstrapToken({
            fixture,
            sandboxInstanceId,
          }),
        });
        connectionSocket = await connectConnectionSocket({
          autoPong: false,
          fixture,
          sandboxInstanceId,
          token: await mintValidConnectionToken({
            fixture,
            sandboxInstanceId,
          }),
        });

        await expect(
          waitForPresenceState({
            fixture,
            predicate: (hasActiveLease) => hasActiveLease,
            sandboxInstanceId,
            store,
          }),
        ).resolves.toBe(true);

        const closeEvent = await waitForWebSocketClose(connectionSocket);
        expect(closeEvent.code).toBe(1011);

        await expect(
          waitForPresenceState({
            fixture,
            predicate: (hasActiveLease) => !hasActiveLease,
            sandboxInstanceId,
            store,
          }),
        ).resolves.toBe(false);
      } finally {
        await closeSocketIfOpen(connectionSocket);
        await closeSocketIfOpen(bootstrapSocket);
        await closeValkeyClient(client);
      }
    },
    IntegrationTestTimeoutMs,
  );
});
