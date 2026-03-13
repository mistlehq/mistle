/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { randomUUID } from "node:crypto";

import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  parseStreamControlMessage,
  type StreamControlMessage,
} from "@mistle/sandbox-session-protocol";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";
import WebSocket from "ws";

import { it } from "./test-context.js";
import {
  closeWebSocket,
  connectWebSocket,
  sendWebSocketMessage,
  sendWebSocketPingAndExpectPong,
  waitForWebSocketClose,
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

      let sandboxSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        sandboxSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

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

  it(
    "forwards text and binary websocket messages between bootstrap and connection peers",
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

      let sandboxSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        sandboxSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        const clientTextPayload = "hello from client";
        const forwardedToSandboxPromise = waitForWebSocketMessage(sandboxSocket);
        await sendWebSocketMessage(clientSocket, clientTextPayload);
        const forwardedToSandbox = await forwardedToSandboxPromise;

        expect(forwardedToSandbox.isBinary).toBe(false);
        expect(forwardedToSandbox.data).toBe(clientTextPayload);

        const sandboxBinaryPayload = Buffer.from([0x01, 0x7f, 0xa5]);
        const forwardedToClientPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(sandboxSocket, sandboxBinaryPayload);
        const forwardedToClient = await forwardedToClientPromise;

        expect(forwardedToClient.isBinary).toBe(true);
        expect(typeof forwardedToClient.data).toBe("object");
        if (typeof forwardedToClient.data === "string") {
          throw new Error("Expected binary websocket message to forward as Buffer.");
        }
        expect(forwardedToClient.data.equals(sandboxBinaryPayload)).toBe(true);
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(sandboxSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "replaces an existing bootstrap peer with a newer one for the same sandbox instance",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const bootstrapTokenOne = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const bootstrapTokenTwo = await mintBootstrapToken({
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

      let firstBootstrapSocket: WebSocket | undefined;
      let secondBootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        firstBootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapTokenOne)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        const firstBootstrapClosedPromise = waitForWebSocketClose(firstBootstrapSocket);
        secondBootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapTokenTwo)}`,
        );
        const firstBootstrapClosed = await firstBootstrapClosedPromise;

        expect(firstBootstrapClosed.code).toBe(1012);
        expect(firstBootstrapClosed.reason).toBe("Replaced by newer sandbox tunnel connection.");

        const clientPayload = "message to replacement bootstrap socket";
        const forwardedToReplacementPromise = waitForWebSocketMessage(secondBootstrapSocket);
        await sendWebSocketMessage(clientSocket, clientPayload);
        const forwardedToReplacement = await forwardedToReplacementPromise;

        expect(forwardedToReplacement.isBinary).toBe(false);
        expect(forwardedToReplacement.data).toBe(clientPayload);
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(firstBootstrapSocket),
          closeWebSocketIfOpen(secondBootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "closes the connection peer when bootstrap peer disconnects",
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

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        const clientClosedPromise = waitForWebSocketClose(clientSocket);
        await closeWebSocket(bootstrapSocket);
        const clientClosed = await clientClosedPromise;

        expect(clientClosed.code).toBe(1012);
        expect(clientClosed.reason).toBe("Sandbox tunnel peer disconnected.");
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(clientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "keeps the bootstrap peer connected when connection peer disconnects",
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

        await closeWebSocket(firstClientSocket);
        firstClientSocket = undefined;

        await sendWebSocketPingAndExpectPong(
          bootstrapSocket,
          Buffer.from("bootstrap-still-open", "utf8"),
        );

        secondClientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(secondConnectionToken)}`,
        );

        const reconnectPayload = "connection reattached";
        const forwardedToBootstrapPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(secondClientSocket, reconnectPayload);
        const forwardedToBootstrap = await forwardedToBootstrapPromise;

        expect(forwardedToBootstrap.isBinary).toBe(false);
        expect(forwardedToBootstrap.data).toBe(reconnectPayload);
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
    "routes PTY control messages through gateway stream bindings and closes PTY streams on connection detach",
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

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        const clientStreamId = 41;
        const forwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: clientStreamId,
            channel: {
              kind: "pty",
              session: "create",
              cols: 120,
              rows: 40,
            },
          }),
        );
        const forwardedOpen = await forwardedOpenPromise;

        expect(forwardedOpen.isBinary).toBe(false);
        const forwardedOpenPayload = parseStreamMessage(forwardedOpen.data);
        expect(forwardedOpenPayload).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "pty",
            session: "create",
            cols: 120,
            rows: 40,
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

        const forwardedClosePromise = waitForWebSocketMessage(bootstrapSocket);
        await closeWebSocket(clientSocket);
        clientSocket = undefined;

        const forwardedClose = await forwardedClosePromise;
        expect(forwardedClose.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedClose.data)).toEqual({
          type: "stream.close",
          streamId: 1,
        });

        await sendWebSocketPingAndExpectPong(
          bootstrapSocket,
          Buffer.from("bootstrap-still-open-after-pty", "utf8"),
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
