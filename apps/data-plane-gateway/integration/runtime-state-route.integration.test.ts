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
import { z } from "zod";

import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";
import { closeWebSocket, waitForWebSocketClose } from "./websocket-test-helpers.js";

const IntegrationTestTimeoutMs = 40_000;
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
    organizationId: "org_runtime_state_route_it",
    sandboxProfileId: "sbp_runtime_state_route_it",
    sandboxProfileVersion: 1,
    runtimeProvider: input.fixture.config.sandbox.provider,
    providerRuntimeId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_runtime_state_route_it",
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

async function waitForRuntimeState(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
  predicate: (snapshot: RuntimeStateSnapshot) => boolean;
}): Promise<RuntimeStateSnapshot> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const snapshot = await readRuntimeState({
      fixture: input.fixture,
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

function connectBootstrapSocket(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
  token: string;
  autoPong?: boolean;
}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${input.fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(input.sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(input.token)}`,
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

describe("runtime state route integration", () => {
  it(
    "returns owner and attachment state for an active bootstrap connection",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
        token: await mintValidBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
      });

      const snapshot = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId !== null && currentSnapshot.attachment !== null,
      });

      expect(snapshot.ownerLeaseId).not.toBeNull();
      expect(snapshot.attachment).not.toBeNull();
      expect(snapshot.attachment?.sandboxInstanceId).toBe(sandboxInstanceId);
      expect(snapshot.attachment?.ownerLeaseId).toBe(snapshot.ownerLeaseId);
      expect(snapshot.attachment?.nodeId).toMatch(/^dpg_/);
      expect(snapshot.attachment?.sessionId).toMatch(/^dts_/);

      await closeWebSocket(bootstrapSocket);

      const clearedSnapshot = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId === null && currentSnapshot.attachment === null,
      });
      expect(clearedSnapshot).toEqual({
        ownerLeaseId: null,
        attachment: null,
      });
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "does not clear the active attachment when a replaced bootstrap socket closes",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });

      const firstSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
        token: await mintValidBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
      });
      const firstSnapshot = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId !== null && currentSnapshot.attachment !== null,
      });
      const firstOwnerLeaseId = firstSnapshot.ownerLeaseId;
      if (firstOwnerLeaseId === null) {
        throw new Error("Expected the first bootstrap connection to establish an owner lease.");
      }

      const firstSocketClosePromise = waitForWebSocketClose(firstSocket);
      const secondSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
        token: await mintValidBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
      });

      const secondSnapshot = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId !== null &&
          currentSnapshot.ownerLeaseId !== firstOwnerLeaseId &&
          currentSnapshot.attachment !== null,
      });

      expect(secondSnapshot.ownerLeaseId).not.toBe(firstOwnerLeaseId);
      expect(secondSnapshot.attachment?.ownerLeaseId).toBe(secondSnapshot.ownerLeaseId);

      const firstSocketClose = await firstSocketClosePromise;
      expect(firstSocketClose.code).toBe(1012);

      const postStaleCloseSnapshot = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId === secondSnapshot.ownerLeaseId &&
          currentSnapshot.attachment?.ownerLeaseId === secondSnapshot.ownerLeaseId,
      });

      expect(postStaleCloseSnapshot.ownerLeaseId).toBe(secondSnapshot.ownerLeaseId);
      expect(postStaleCloseSnapshot.attachment?.ownerLeaseId).toBe(secondSnapshot.ownerLeaseId);

      await closeWebSocket(secondSocket);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "closes an unresponsive bootstrap websocket and clears runtime attachment state",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
        token: await mintValidBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
        autoPong: false,
      });

      const closeEvent = await waitForWebSocketClose(bootstrapSocket);
      expect(closeEvent.code).toBe(1011);

      const clearedSnapshot = await waitForRuntimeState({
        fixture,
        sandboxInstanceId,
        predicate: (currentSnapshot) =>
          currentSnapshot.ownerLeaseId === null && currentSnapshot.attachment === null,
      });

      expect(clearedSnapshot).toEqual({
        ownerLeaseId: null,
        attachment: null,
      });
    },
    IntegrationTestTimeoutMs,
  );
});
