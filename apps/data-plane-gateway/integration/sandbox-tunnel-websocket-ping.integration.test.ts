/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { randomUUID } from "node:crypto";

import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import { describe } from "vitest";
import WebSocket from "ws";

import { it } from "./test-context.js";
import {
  closeWebSocket,
  connectWebSocket,
  sendWebSocketPingAndExpectPong,
} from "./websocket-test-helpers.js";

const IntegrationTestTimeoutMs = 30_000;

async function closeWebSocketIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket === undefined) {
    return;
  }
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}

describe("sandbox tunnel websocket ping integration", () => {
  it(
    "accepts websocket connections for bootstrap and connection tokens and responds to ping on both",
    async ({ fixture }) => {
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId: `sbi_${randomUUID().replaceAll("-", "")}`,
        ttlSeconds: 120,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId: `sbi_${randomUUID().replaceAll("-", "")}`,
        ttlSeconds: 120,
      });

      let sandboxSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        [sandboxSocket, clientSocket] = await Promise.all([
          connectWebSocket(
            `${fixture.websocketBaseUrl}/tunnel/sandbox?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
          ),
          connectWebSocket(
            `${fixture.websocketBaseUrl}/tunnel/sandbox?connect_token=${encodeURIComponent(connectionToken)}`,
          ),
        ]);

        await Promise.all([
          sendWebSocketPingAndExpectPong(sandboxSocket, Buffer.from("sandbox-ping", "utf8")),
          sendWebSocketPingAndExpectPong(clientSocket, Buffer.from("client-ping", "utf8")),
        ]);
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(sandboxSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );
});
