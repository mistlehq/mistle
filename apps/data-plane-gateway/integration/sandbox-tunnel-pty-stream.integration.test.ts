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

describe("sandbox tunnel pty stream integration", () => {
  it(
    "routes PTY control messages through gateway stream bindings and closes PTY streams on connection detach",
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
        expect(parseStreamMessage(forwardedOpen.data)).toEqual({
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

  it(
    "releases PTY stream bindings on client stream.close and ignores late pty.exit events",
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

        const clientStreamId = 41;
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
        await waitForWebSocketMessage(bootstrapSocket);

        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        await waitForWebSocketMessage(clientSocket);

        const forwardedClosePromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.close",
            streamId: clientStreamId,
          }),
        );
        const forwardedClose = await forwardedClosePromise;

        expect(forwardedClose.isBinary).toBe(false);
        expect(parseStreamMessage(forwardedClose.data)).toEqual({
          type: "stream.close",
          streamId: 1,
        });

        const bootstrapNoMessagePromise = waitForNoWebSocketMessage(bootstrapSocket);
        const clientNoMessagePromise = waitForNoWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.event",
            streamId: 1,
            event: {
              type: "pty.exit",
              exitCode: 0,
            },
          }),
        );
        await Promise.all([bootstrapNoMessagePromise, clientNoMessagePromise]);

        const reopenedForwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: 42,
            channel: {
              kind: "pty",
              session: "create",
              cols: 120,
              rows: 40,
            },
          }),
        );
        const reopenedForwardedOpen = await reopenedForwardedOpenPromise;

        expect(reopenedForwardedOpen.isBinary).toBe(false);
        expect(parseStreamMessage(reopenedForwardedOpen.data)).toEqual({
          type: "stream.open",
          streamId: 2,
          channel: {
            kind: "pty",
            session: "create",
            cols: 120,
            rows: 40,
          },
        });

        const reopenedOpenOkPromise = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 2,
          }),
        );
        const reopenedOpenOk = await reopenedOpenOkPromise;

        expect(reopenedOpenOk.isBinary).toBe(false);
        expect(parseStreamMessage(reopenedOpenOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: 42,
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
    "releases attached PTY stream bindings on client stream.close so the same client websocket can reattach",
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
      const primaryConnectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      });
      const attachedConnectionToken = await mintConnectionToken({
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
      let primaryClientSocket: WebSocket | undefined;
      let attachedClientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapToken)}`,
        );
        primaryClientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(primaryConnectionToken)}`,
        );
        attachedClientSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?connect_token=${encodeURIComponent(attachedConnectionToken)}`,
        );

        const primaryOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          primaryClientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: 41,
            channel: {
              kind: "pty",
              session: "create",
              cols: 120,
              rows: 40,
            },
          }),
        );
        const primaryOpen = await primaryOpenPromise;

        expect(primaryOpen.isBinary).toBe(false);
        expect(parseStreamMessage(primaryOpen.data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "pty",
            session: "create",
            cols: 120,
            rows: 40,
          },
        });

        const primaryOpenOkPromise = waitForWebSocketMessage(primaryClientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        const primaryOpenOk = await primaryOpenOkPromise;

        expect(primaryOpenOk.isBinary).toBe(false);
        expect(parseStreamMessage(primaryOpenOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: 41,
        });

        const attachedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          attachedClientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: 52,
            channel: {
              kind: "pty",
              session: "attach",
            },
          }),
        );
        const attachedOpen = await attachedOpenPromise;

        expect(attachedOpen.isBinary).toBe(false);
        expect(parseStreamMessage(attachedOpen.data)).toEqual({
          type: "stream.open",
          streamId: 2,
          channel: {
            kind: "pty",
            session: "attach",
          },
        });

        const attachedOpenOkPromise = waitForWebSocketMessage(attachedClientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 2,
          }),
        );
        const attachedOpenOk = await attachedOpenOkPromise;

        expect(attachedOpenOk.isBinary).toBe(false);
        expect(parseStreamMessage(attachedOpenOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: 52,
        });

        const attachedClosePromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          attachedClientSocket,
          JSON.stringify({
            type: "stream.close",
            streamId: 52,
          }),
        );
        const attachedClose = await attachedClosePromise;

        expect(attachedClose.isBinary).toBe(false);
        expect(parseStreamMessage(attachedClose.data)).toEqual({
          type: "stream.close",
          streamId: 2,
        });

        const reattachOpenPromise = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          attachedClientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: 53,
            channel: {
              kind: "pty",
              session: "attach",
            },
          }),
        );
        const reattachOpen = await reattachOpenPromise;

        expect(reattachOpen.isBinary).toBe(false);
        expect(parseStreamMessage(reattachOpen.data)).toEqual({
          type: "stream.open",
          streamId: 3,
          channel: {
            kind: "pty",
            session: "attach",
          },
        });

        const reattachOpenOkPromise = waitForWebSocketMessage(attachedClientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 3,
          }),
        );
        const reattachOpenOk = await reattachOpenOkPromise;

        expect(reattachOpenOk.isBinary).toBe(false);
        expect(parseStreamMessage(reattachOpenOk.data)).toEqual({
          type: "stream.open.ok",
          streamId: 53,
        });
      } finally {
        await Promise.all([
          closeWebSocketIfOpen(bootstrapSocket),
          closeWebSocketIfOpen(primaryClientSocket),
          closeWebSocketIfOpen(attachedClientSocket),
        ]);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "resets client PTY streams when a newer bootstrap peer replaces the current one",
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

        const clientStreamId = 41;
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
        await waitForWebSocketMessage(firstBootstrapSocket);

        await sendWebSocketMessage(
          firstBootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        await waitForWebSocketMessage(clientSocket);

        const firstBootstrapClosedPromise = waitForWebSocketClose(firstBootstrapSocket);
        const clientResetPromise = waitForWebSocketMessage(clientSocket);
        secondBootstrapSocket = await connectWebSocket(
          `${fixture.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(sandboxInstanceId)}?bootstrap_token=${encodeURIComponent(bootstrapTokenTwo)}`,
        );
        const firstBootstrapClosed = await firstBootstrapClosedPromise;
        const clientReset = await clientResetPromise;

        expect(firstBootstrapClosed.code).toBe(1012);
        expect(firstBootstrapClosed.reason).toBe("Replaced by newer sandbox tunnel connection.");
        expect(clientReset.isBinary).toBe(false);
        expect(parseStreamMessage(clientReset.data)).toEqual({
          type: "stream.reset",
          streamId: clientStreamId,
          code: "bootstrap_reconnected",
          message: "Sandbox bootstrap tunnel reconnected and invalidated the active PTY stream.",
        });

        await Promise.all([
          sendWebSocketPingAndExpectPong(
            secondBootstrapSocket,
            Buffer.from("new-bootstrap", "utf8"),
          ),
          sendWebSocketPingAndExpectPong(clientSocket, Buffer.from("client-still-open", "utf8")),
        ]);
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
});
