/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { randomUUID } from "node:crypto";

import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import { parsePublishControlMessage, type LiveListener } from "@mistle/sandbox-session-protocol";
import { describe, expect } from "vitest";

import { insertSandboxInstanceRow } from "./runtime-state-test-helpers.js";
import { it } from "./test-context.js";
import type { DataPlaneGatewayIntegrationFixture } from "./test-context.js";
import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
  waitForNoWebSocketMessage,
  waitForWebSocketClose,
  waitForWebSocketMessage,
} from "./websocket-test-helpers.js";

const IntegrationTestTimeoutMs = 30_000;

function createBootstrapToken(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
}): Promise<string> {
  return mintBootstrapToken({
    config: {
      bootstrapTokenSecret: input.fixture.config.sandbox.bootstrap.tokenSecret,
      tokenAudience: input.fixture.config.sandbox.bootstrap.tokenAudience,
      tokenIssuer: input.fixture.config.sandbox.bootstrap.tokenIssuer,
    },
    jti: randomUUID(),
    sandboxInstanceId: input.sandboxInstanceId,
    ttlSeconds: 120,
  });
}

function createConnectionToken(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
}): Promise<string> {
  return mintConnectionToken({
    config: {
      connectionTokenSecret: input.fixture.config.sandbox.connect.tokenSecret,
      tokenAudience: input.fixture.config.sandbox.connect.tokenAudience,
      tokenIssuer: input.fixture.config.sandbox.connect.tokenIssuer,
    },
    jti: randomUUID(),
    sandboxInstanceId: input.sandboxInstanceId,
    ttlSeconds: 120,
  });
}

describe("publish.listeners tunnel integration", () => {
  it(
    "relays listener snapshot requests from the connection peer to the bootstrap peer",
    async ({ fixture }) => {
      const sandboxInstanceId = "sbi_publish_listeners_001";
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "publish_listeners",
      });

      const bootstrapSocket = await connectSandboxTunnelWebSocket({
        sandboxInstanceId,
        token: await createBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
        tokenKind: "bootstrap",
        websocketBaseUrl: fixture.websocketBaseUrl,
      });
      const connectionSocket = await connectSandboxTunnelWebSocket({
        sandboxInstanceId,
        token: await createConnectionToken({
          fixture,
          sandboxInstanceId,
        }),
        tokenKind: "connect",
        websocketBaseUrl: fixture.websocketBaseUrl,
      });

      const listeners: LiveListener[] = [
        {
          bindAddress: "127.0.0.1",
          command: "vite",
          observedAt: "2026-04-01T00:00:00.000Z",
          owner: {
            kind: "unknown-process",
          },
          pid: 501,
          port: 5173,
          visibility: "user_selectable",
        },
      ];

      try {
        await sendWebSocketMessage(
          connectionSocket,
          JSON.stringify({
            type: "publish.listeners.get",
            requestId: "client_req_1",
          }),
        );

        const forwardedRequest = parsePublishControlMessage(
          String((await waitForWebSocketMessage(bootstrapSocket)).data),
        );
        if (forwardedRequest?.type !== "publish.listeners.get") {
          throw new Error("Expected bootstrap peer to receive publish.listeners.get.");
        }
        expect(forwardedRequest.requestId).not.toBe("client_req_1");

        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "publish.listeners.snapshot",
            requestId: forwardedRequest.requestId,
            observedAt: "2026-04-01T00:00:00.000Z",
            listeners,
          }),
        );

        expect(
          parsePublishControlMessage(
            String((await waitForWebSocketMessage(connectionSocket)).data),
          ),
        ).toEqual({
          type: "publish.listeners.snapshot",
          requestId: "client_req_1",
          observedAt: "2026-04-01T00:00:00.000Z",
          listeners,
        });
      } finally {
        await closeWebSocket(connectionSocket);
        await closeWebSocket(bootstrapSocket);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "rejects duplicate publish listener request ids within one connection session",
    async ({ fixture }) => {
      const sandboxInstanceId = "sbi_publish_listeners_002";
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "publish_listeners_dup",
      });

      const bootstrapSocket = await connectSandboxTunnelWebSocket({
        sandboxInstanceId,
        token: await createBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
        tokenKind: "bootstrap",
        websocketBaseUrl: fixture.websocketBaseUrl,
      });
      const connectionSocket = await connectSandboxTunnelWebSocket({
        sandboxInstanceId,
        token: await createConnectionToken({
          fixture,
          sandboxInstanceId,
        }),
        tokenKind: "connect",
        websocketBaseUrl: fixture.websocketBaseUrl,
      });

      try {
        await sendWebSocketMessage(
          connectionSocket,
          JSON.stringify({
            type: "publish.listeners.get",
            requestId: "client_req_1",
          }),
        );
        await waitForWebSocketMessage(bootstrapSocket);

        await sendWebSocketMessage(
          connectionSocket,
          JSON.stringify({
            type: "publish.listeners.get",
            requestId: "client_req_1",
          }),
        );

        const closeEvent = await waitForWebSocketClose(connectionSocket);
        expect(closeEvent.code).toBe(1008);
        expect(closeEvent.reason).toContain("already has an in-flight publish request");
      } finally {
        await closeWebSocket(bootstrapSocket);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "drops delayed bootstrap snapshots after the connection websocket closes",
    async ({ fixture }) => {
      const sandboxInstanceId = "sbi_publish_listeners_003";
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "publish_listeners_close",
      });

      const bootstrapSocket = await connectSandboxTunnelWebSocket({
        sandboxInstanceId,
        token: await createBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
        tokenKind: "bootstrap",
        websocketBaseUrl: fixture.websocketBaseUrl,
      });
      const connectionSocket = await connectSandboxTunnelWebSocket({
        sandboxInstanceId,
        token: await createConnectionToken({
          fixture,
          sandboxInstanceId,
        }),
        tokenKind: "connect",
        websocketBaseUrl: fixture.websocketBaseUrl,
      });

      try {
        await sendWebSocketMessage(
          connectionSocket,
          JSON.stringify({
            type: "publish.listeners.get",
            requestId: "client_req_1",
          }),
        );
        const forwardedRequest = parsePublishControlMessage(
          String((await waitForWebSocketMessage(bootstrapSocket)).data),
        );
        if (forwardedRequest?.type !== "publish.listeners.get") {
          throw new Error("Expected bootstrap peer to receive publish.listeners.get.");
        }

        await closeWebSocket(connectionSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "publish.listeners.snapshot",
            requestId: forwardedRequest.requestId,
            observedAt: "2026-04-01T00:00:00.000Z",
            listeners: [],
          }),
        );

        await waitForNoWebSocketMessage(bootstrapSocket);
      } finally {
        await closeWebSocket(bootstrapSocket);
      }
    },
    IntegrationTestTimeoutMs,
  );
});
