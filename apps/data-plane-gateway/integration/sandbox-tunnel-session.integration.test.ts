/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses, sandboxInstances } from "@mistle/db/data-plane";
import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  parseStreamControlMessage,
  type StreamControlMessage,
} from "@mistle/sandbox-session-protocol";
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
  waitForWebSocketMessage,
} from "./websocket-test-helpers.js";

const IntegrationTestTimeoutMs = 30_000;

function parseStreamMessage(data: string | Buffer): StreamControlMessage {
  if (typeof data !== "string") {
    throw new Error("Expected websocket message data to be a string.");
  }

  const parsedPayload = parseStreamControlMessage(data);
  if (parsedPayload === undefined) {
    throw new Error("Expected websocket message payload to be a valid stream control message.");
  }

  return parsedPayload;
}

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
  if (socket === undefined) {
    return;
  }
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}

describe("sandbox tunnel session lifecycle integration", () => {
  it(
    "keeps the bootstrap peer connected after a connection peer disconnects and accepts a fresh connection token",
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
      const firstConnectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const secondConnectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      let bootstrapSocket: WebSocket | undefined;
      let firstClientSocket: WebSocket | undefined;
      let secondClientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        firstClientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(firstConnectionToken)}`,
        );

        const bootstrapNoMessagePromise = waitForNoWebSocketMessage(bootstrapSocket);
        await closeWebSocket(firstClientSocket);
        firstClientSocket = undefined;
        await bootstrapNoMessagePromise;

        await sendWebSocketPingAndExpectPong(
          bootstrapSocket,
          Buffer.from("bootstrap-still-open", "utf8"),
        );

        secondClientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(secondConnectionToken)}`,
        );

        const forwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          secondClientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: 44,
            channel: {
              kind: "agent",
            },
          }),
        );
        const forwardedOpen = await forwardedOpenPromise;

        expect(forwardedOpen.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedOpen.data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "agent",
          },
        });
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(firstClientSocket),
          closeWebSocketIfOpen(secondClientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "notifies active connection peers when the bootstrap tunnel disconnects and keeps the client websocket open",
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

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        const clientStreamId = 77;
        const forwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: clientStreamId,
            channel: {
              kind: "agent",
            },
          }),
        );
        const forwardedOpen = await forwardedOpenPromise;

        expect(forwardedOpen.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedOpen.data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "agent",
          },
        });

        const forwardedOpenOkPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        const forwardedOpenOk = await forwardedOpenOkPromise;

        expect(forwardedOpenOk.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedOpenOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: clientStreamId,
        });

        const clientResetPromise = waitForWebSocketMessage(clientSocket);
        await closeWebSocket(bootstrapSocket);
        bootstrapSocket = undefined;
        const clientReset = await clientResetPromise;

        expect(clientReset.isBinary).toBe(false);
        expect(parseStreamMessage(clientReset.data)).toEqual({
          type: "stream.reset",
          streamId: clientStreamId,
          code: "bootstrap_disconnected",
          message:
            "Sandbox bootstrap tunnel disconnected and invalidated the active interactive stream.",
        });

        await sendWebSocketPingAndExpectPong(
          clientSocket,
          Buffer.from("client-still-open-after-bootstrap-disconnect", "utf8"),
        );
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );
});
