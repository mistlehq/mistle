/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses, sandboxInstances } from "@mistle/db/data-plane";
import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  DataFrameKindData,
  decodeDataFrame,
  encodeDataFrame,
  parseStreamControlMessage,
  PayloadKindWebSocketBinary,
  PayloadKindWebSocketText,
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
  waitForNoWebSocketMessage,
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

function parseDataFrame(data: string | Buffer) {
  if (typeof data === "string") {
    throw new Error("Expected websocket message data to be binary.");
  }

  return decodeDataFrame(new Uint8Array(data));
}

function encodeWebSocketTextDataFrame(input: { payload: string; streamId: number }): Uint8Array {
  return encodeDataFrame({
    streamId: input.streamId,
    payloadKind: PayloadKindWebSocketText,
    payload: Buffer.from(input.payload, "utf8"),
  });
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

describe("sandbox tunnel websocket integration", () => {
  it(
    "responds to the connection peer when an interactive control message is not bound",
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

        const bootstrapNoMessagePromise = waitForNoWebSocketMessage(bootstrapSocket);
        const clientResetPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.close",
            streamId: 77,
          }),
        );
        const clientReset = await clientResetPromise;

        expect(clientReset.isBinary).toBe(false);
        expect(parseStreamMessage(clientReset.data)).toEqual({
          type: "stream.reset",
          streamId: 77,
          code: "interactive_stream_not_found",
          message: "Interactive stream is not bound on this tunnel session.",
        });
        await bootstrapNoMessagePromise;
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
    "responds to the bootstrap peer when an interactive data frame is not bound",
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

        const clientNoMessagePromise = waitForNoWebSocketMessage(clientSocket);
        const bootstrapResetPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: 1,
              payloadKind: PayloadKindWebSocketBinary,
              payload: new Uint8Array([0x41, 0x42]),
            }),
          ),
        );
        const bootstrapReset = await bootstrapResetPromise;

        expect(bootstrapReset.isBinary).toBe(false);
        expect(parseStreamMessage(bootstrapReset.data)).toEqual({
          type: "stream.reset",
          streamId: 1,
          code: "interactive_stream_not_found",
          message: "Interactive stream is not bound on this tunnel session.",
        });
        await clientNoMessagePromise;
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
    "accepts websocket connections for bootstrap and connection tokens and responds to ping on both",
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

        await Promise.all([
          sendWebSocketPingAndExpectPong(bootstrapSocket, Buffer.from("sandbox-ping", "utf8")),
          sendWebSocketPingAndExpectPong(clientSocket, Buffer.from("client-ping", "utf8")),
        ]);
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
    "closes the connection peer when it sends opaque text or binary websocket payloads",
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

        const bootstrapNoMessagePromise = waitForNoWebSocketMessage(bootstrapSocket);
        const clientClosedOnTextPromise = waitForWebSocketClose(clientSocket);
        await sendWebSocketMessage(clientSocket, "hello from client");
        await expect(clientClosedOnTextPromise).resolves.toEqual({
          code: 1008,
          reason: "Connection websocket text payloads must be valid stream control messages.",
        });
        await bootstrapNoMessagePromise;

        clientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(connectionToken)}`,
        );

        const bootstrapStillNoMessagePromise = waitForNoWebSocketMessage(bootstrapSocket);
        const clientClosedOnBinaryPromise = waitForWebSocketClose(clientSocket);
        await sendWebSocketMessage(clientSocket, Buffer.from([0x01, 0x7f, 0xa5]));
        await expect(clientClosedOnBinaryPromise).resolves.toEqual({
          code: 1008,
          reason: "Connection websocket binary payloads must be valid tunnel data frames.",
        });
        await bootstrapStillNoMessagePromise;
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
    "closes the connection peer when it sends a control message reserved for bootstrap responses",
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

        const bootstrapNoMessagePromise = waitForNoWebSocketMessage(bootstrapSocket);
        const clientClosedPromise = waitForWebSocketClose(clientSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        await expect(clientClosedPromise).resolves.toEqual({
          code: 1008,
          reason: "Connection websocket cannot send control message type 'stream.open.ok'.",
        });
        await bootstrapNoMessagePromise;
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
    "remaps binary data frame stream ids between connection and bootstrap peers",
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
        await forwardedOpenPromise;

        const forwardedOpenOkPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        await forwardedOpenOkPromise;

        const forwardedClientDataPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: clientStreamId,
              payloadKind: PayloadKindWebSocketBinary,
              payload: new Uint8Array([0xaa, 0xbb, 0xcc]),
            }),
          ),
        );
        const forwardedClientData = await forwardedClientDataPromise;

        expect(forwardedClientData.isBinary).toBe(true);
        expect(parseDataFrame(forwardedClientData.data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: 1,
          payloadKind: PayloadKindWebSocketBinary,
          payload: new Uint8Array([0xaa, 0xbb, 0xcc]),
        });

        const forwardedBootstrapDataPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: 1,
              payloadKind: PayloadKindWebSocketBinary,
              payload: new Uint8Array([0x11, 0x22, 0x33]),
            }),
          ),
        );
        const forwardedBootstrapData = await forwardedBootstrapDataPromise;

        expect(forwardedBootstrapData.isBinary).toBe(true);
        expect(parseDataFrame(forwardedBootstrapData.data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: clientStreamId,
          payloadKind: PayloadKindWebSocketBinary,
          payload: new Uint8Array([0x11, 0x22, 0x33]),
        });
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
    "replaces an existing bootstrap peer with a newer one for the same sandbox instance",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
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

        const firstClientStreamId = 77;
        const forwardedInitialOpenPromise = waitForWebSocketMessage(firstBootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: firstClientStreamId,
            channel: {
              kind: "agent",
            },
          }),
        );
        const forwardedInitialOpen = await forwardedInitialOpenPromise;

        expect(forwardedInitialOpen.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedInitialOpen.data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "agent",
          },
        });

        const initialOpenOkPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          firstBootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        const initialOpenOk = await initialOpenOkPromise;

        expect(initialOpenOk.isBinary).toBe(false);
        expect(parseStreamMessage(initialOpenOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: firstClientStreamId,
        });

        const firstBootstrapClosedPromise = waitForWebSocketClose(firstBootstrapSocket);
        const releasedStreamResetPromise = waitForWebSocketMessage(clientSocket);
        secondBootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapTokenTwo)}`,
        );
        const firstBootstrapClosed = await firstBootstrapClosedPromise;
        const releasedStreamReset = await releasedStreamResetPromise;

        expect(firstBootstrapClosed.code).toBe(1012);
        expect(firstBootstrapClosed.reason).toBe("Replaced by newer sandbox tunnel connection.");
        expect(releasedStreamReset.isBinary).toBe(false);
        expect(parseStreamMessage(releasedStreamReset.data)).toEqual({
          type: "stream.reset",
          streamId: firstClientStreamId,
          code: "bootstrap_reconnected",
          message:
            "Sandbox bootstrap tunnel reconnected and invalidated the active interactive stream.",
        });

        const replacementClientStreamId = 78;
        const forwardedReplacementOpenPromise = waitForWebSocketMessage(secondBootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: replacementClientStreamId,
            channel: {
              kind: "agent",
            },
          }),
        );
        const forwardedReplacementOpen = await forwardedReplacementOpenPromise;

        expect(forwardedReplacementOpen.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedReplacementOpen.data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "agent",
          },
        });
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
    "resets the active interactive stream and keeps the connection peer open when bootstrap peer disconnects",
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

  it(
    "returns stream.open.error when the bootstrap peer disconnects before a new stream is opened",
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

        await closeWebSocket(bootstrapSocket);
        bootstrapSocket = undefined;
        await waitForNoWebSocketMessage(clientSocket);

        const rejectedOpenPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: 2,
            channel: {
              kind: "agent",
            },
          }),
        );
        const rejectedOpen = await rejectedOpenPromise;

        expect(rejectedOpen.isBinary).toBe(false);
        expect(parseStreamMessage(rejectedOpen.data)).toEqual({
          type: "stream.open.error",
          streamId: 2,
          code: "bootstrap_not_connected",
          message: `Sandbox bootstrap tunnel is not connected for sandbox '${sandboxInstanceId}'.`,
        });

        await sendWebSocketPingAndExpectPong(
          clientSocket,
          Buffer.from("client-still-open-after-open-error", "utf8"),
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

  it(
    "keeps the bootstrap peer connected when connection peer disconnects",
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
    "keeps multiple connection peers attached and routes active streams independently",
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
        secondClientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(secondConnectionToken)}`,
        );

        await Promise.all([
          sendWebSocketPingAndExpectPong(
            firstClientSocket,
            Buffer.from("first-client-still-open", "utf8"),
          ),
          sendWebSocketPingAndExpectPong(
            secondClientSocket,
            Buffer.from("second-client-still-open", "utf8"),
          ),
        ]);

        const firstClientStreamId = 77;
        const firstOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          firstClientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: firstClientStreamId,
            channel: {
              kind: "agent",
            },
          }),
        );
        const firstOpen = await firstOpenPromise;

        expect(firstOpen.isBinary).toBe(false);
        expect(parseStreamMessage(firstOpen.data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "agent",
          },
        });

        const secondClientStreamId = 88;
        const secondOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          secondClientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: secondClientStreamId,
            channel: {
              kind: "agent",
            },
          }),
        );
        const secondOpen = await secondOpenPromise;

        expect(secondOpen.isBinary).toBe(false);
        expect(parseStreamMessage(secondOpen.data)).toEqual({
          type: "stream.open",
          streamId: 2,
          channel: {
            kind: "agent",
          },
        });

        const firstOpenOkPromise = waitForWebSocketMessage(firstClientSocket);
        const secondOpenOkPromise = waitForWebSocketMessage(secondClientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 2,
          }),
        );
        const [firstOpenOk, secondOpenOk] = await Promise.all([
          firstOpenOkPromise,
          secondOpenOkPromise,
        ]);

        expect(firstOpenOk.isBinary).toBe(false);
        expect(parseStreamMessage(firstOpenOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: firstClientStreamId,
        });
        expect(secondOpenOk.isBinary).toBe(false);
        expect(parseStreamMessage(secondOpenOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: secondClientStreamId,
        });

        const firstClientDataPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          firstClientSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: firstClientStreamId,
              payloadKind: PayloadKindWebSocketBinary,
              payload: new Uint8Array([0xaa, 0xbb, 0xcc]),
            }),
          ),
        );
        const firstClientData = await firstClientDataPromise;

        expect(firstClientData.isBinary).toBe(true);
        expect(parseDataFrame(firstClientData.data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: 1,
          payloadKind: PayloadKindWebSocketBinary,
          payload: new Uint8Array([0xaa, 0xbb, 0xcc]),
        });

        const secondClientDataPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          secondClientSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: secondClientStreamId,
              payloadKind: PayloadKindWebSocketBinary,
              payload: new Uint8Array([0x11, 0x22, 0x33]),
            }),
          ),
        );
        const secondClientData = await secondClientDataPromise;

        expect(secondClientData.isBinary).toBe(true);
        expect(parseDataFrame(secondClientData.data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: 2,
          payloadKind: PayloadKindWebSocketBinary,
          payload: new Uint8Array([0x11, 0x22, 0x33]),
        });

        const firstBootstrapDataPromise = waitForWebSocketMessage(firstClientSocket);
        const secondBootstrapDataPromise = waitForWebSocketMessage(secondClientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: 1,
              payloadKind: PayloadKindWebSocketBinary,
              payload: new Uint8Array([0xde, 0xad]),
            }),
          ),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: 2,
              payloadKind: PayloadKindWebSocketBinary,
              payload: new Uint8Array([0xbe, 0xef]),
            }),
          ),
        );
        const [firstBootstrapData, secondBootstrapData] = await Promise.all([
          firstBootstrapDataPromise,
          secondBootstrapDataPromise,
        ]);

        expect(firstBootstrapData.isBinary).toBe(true);
        expect(parseDataFrame(firstBootstrapData.data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: firstClientStreamId,
          payloadKind: PayloadKindWebSocketBinary,
          payload: new Uint8Array([0xde, 0xad]),
        });
        expect(secondBootstrapData.isBinary).toBe(true);
        expect(parseDataFrame(secondBootstrapData.data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: secondClientStreamId,
          payloadKind: PayloadKindWebSocketBinary,
          payload: new Uint8Array([0xbe, 0xef]),
        });

        const firstClosePromise = waitForWebSocketMessage(bootstrapSocket);
        await closeWebSocket(firstClientSocket);
        firstClientSocket = undefined;
        const firstClose = await firstClosePromise;

        expect(firstClose.isBinary).toBe(false);
        expect(parseStreamMessage(firstClose.data)).toEqual({
          type: "stream.close",
          streamId: 1,
        });

        await sendWebSocketPingAndExpectPong(
          secondClientSocket,
          Buffer.from("second-client-still-open-after-first-close", "utf8"),
        );

        const secondClientStillRoutesPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          secondClientSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: secondClientStreamId,
              payloadKind: PayloadKindWebSocketBinary,
              payload: new Uint8Array([0x44, 0x55]),
            }),
          ),
        );
        const secondClientStillRoutes = await secondClientStillRoutesPromise;

        expect(secondClientStillRoutes.isBinary).toBe(true);
        expect(parseDataFrame(secondClientStillRoutes.data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: 2,
          payloadKind: PayloadKindWebSocketBinary,
          payload: new Uint8Array([0x44, 0x55]),
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
    "routes agent stream opens through gateway bindings and closes agent streams on connection detach",
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

        const forwardedAgentTextPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          Buffer.from(
            encodeWebSocketTextDataFrame({
              streamId: clientStreamId,
              payload: JSON.stringify({ jsonrpc: "2.0", method: "ping" }),
            }),
          ),
        );
        const forwardedAgentText = await forwardedAgentTextPromise;

        expect(forwardedAgentText.isBinary).toBe(true);
        expect(parseDataFrame(forwardedAgentText.data)).toEqual({
          streamId: 1,
          payloadKind: PayloadKindWebSocketText,
          payload: Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "ping" }), "utf8"),
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
          Buffer.from("bootstrap-still-open-after-agent", "utf8"),
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

  it(
    "releases agent stream bindings after a client stream.close so the same client websocket can open a new stream",
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

        const firstForwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: 77,
            channel: {
              kind: "agent",
            },
          }),
        );
        const firstForwardedOpen = await firstForwardedOpenPromise;

        expect(firstForwardedOpen.isBinary).toBe(false);
        expect(parseStreamMessage(firstForwardedOpen.data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "agent",
          },
        });

        const firstForwardedOpenOkPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        const firstForwardedOpenOk = await firstForwardedOpenOkPromise;

        expect(firstForwardedOpenOk.isBinary).toBe(false);
        expect(parseStreamMessage(firstForwardedOpenOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: 77,
        });

        const forwardedClosePromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.close",
            streamId: 77,
          }),
        );
        const forwardedClose = await forwardedClosePromise;

        expect(forwardedClose.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedClose.data)).toEqual({
          type: "stream.close",
          streamId: 1,
        });

        const secondForwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: 78,
            channel: {
              kind: "agent",
            },
          }),
        );
        const secondForwardedOpen = await secondForwardedOpenPromise;

        expect(secondForwardedOpen.isBinary).toBe(false);
        expect(parseStreamMessage(secondForwardedOpen.data)).toEqual({
          type: "stream.open",
          streamId: 2,
          channel: {
            kind: "agent",
          },
        });

        const secondForwardedOpenOkPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 2,
          }),
        );
        const secondForwardedOpenOk = await secondForwardedOpenOkPromise;

        expect(secondForwardedOpenOk.isBinary).toBe(false);
        expect(parseStreamMessage(secondForwardedOpenOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: 78,
        });
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
    "rejects opening a second interactive stream on the same connection peer",
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

        const forwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: 77,
            channel: {
              kind: "agent",
            },
          }),
        );
        await forwardedOpenPromise;

        const rejectedOpenPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: 78,
            channel: {
              kind: "pty",
              session: "create",
              cols: 80,
              rows: 24,
            },
          }),
        );
        const rejectedOpen = await rejectedOpenPromise;

        expect(rejectedOpen.isBinary).toBe(false);
        const rejectedOpenPayload = parseStreamMessage(rejectedOpen.data);
        if (rejectedOpenPayload.type !== "stream.open.error") {
          throw new Error("Expected rejected stream open to produce stream.open.error.");
        }
        expect(rejectedOpenPayload.streamId).toBe(78);
        expect(rejectedOpenPayload.code).toBe("client_session_already_open");
        expect(rejectedOpenPayload.message).toContain(
          "already has an active interactive stream bound to the bootstrap tunnel.",
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
