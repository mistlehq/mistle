/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  DataFrameKindData,
  PayloadKindRawBytes,
  PayloadKindWebSocketText,
  decodeDataFrame,
  encodeDataFrame,
  parseStreamControlMessage,
  type StreamControlMessage,
} from "@mistle/sandbox-session-protocol";
import {
  TestEnvironmentIdHeader,
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";
import WebSocket from "ws";

import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
  sendWebSocketPingAndExpectPong,
  waitForNoWebSocketMessage,
  waitForWebSocketMessage,
} from "../integration/websocket-test-helpers.js";

const TestTimeoutMs = 30_000;
const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";
const ConnectionTokenSecret = "integration-new-connection-secret";
const ConnectionTokenIssuer = "integration-new-control-plane-api";

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
});

describe.concurrent("sandbox tunnel stream routing integration", () => {
  it(
    "routes file upload streams through gateway bindings and relays raw bytes plus completion events",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
        clientSocket = await connectConnectionSocket({ env, sandboxInstanceId });

        const clientStreamId = 52;
        const forwardedOpen = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: clientStreamId,
            channel: {
              kind: "fileUpload",
              threadId: "thread_gateway_stream_routing",
              mimeType: "image/png",
              originalFilename: "gateway.png",
              sizeBytes: 3,
            },
          }),
        );

        expect(parseStreamMessage((await forwardedOpen).data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "fileUpload",
            threadId: "thread_gateway_stream_routing",
            mimeType: "image/png",
            originalFilename: "gateway.png",
            sizeBytes: 3,
          },
        });

        const forwardedOpenOk = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        expect(parseStreamMessage((await forwardedOpenOk).data)).toEqual({
          type: "stream.open.ok",
          streamId: clientStreamId,
        });

        const forwardedData = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          Buffer.from(
            encodeDataFrame({
              streamId: clientStreamId,
              payloadKind: PayloadKindRawBytes,
              payload: new Uint8Array([1, 2, 3]),
            }),
          ),
        );
        expect(parseDataFrame((await forwardedData).data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: 1,
          payloadKind: PayloadKindRawBytes,
          payload: new Uint8Array([1, 2, 3]),
        });

        const forwardedCompletion = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.event",
            streamId: 1,
            event: {
              type: "fileUpload.completed",
              kind: "image",
              attachmentId: "att_gateway_stream_routing",
              threadId: "thread_gateway_stream_routing",
              originalFilename: "gateway.png",
              mimeType: "image/png",
              sizeBytes: 3,
              path: "/root/.local/attachments/thread_gateway_stream_routing/gateway.png",
            },
          }),
        );
        expect(parseStreamMessage((await forwardedCompletion).data)).toEqual({
          type: "stream.event",
          streamId: clientStreamId,
          event: {
            type: "fileUpload.completed",
            kind: "image",
            attachmentId: "att_gateway_stream_routing",
            threadId: "thread_gateway_stream_routing",
            originalFilename: "gateway.png",
            mimeType: "image/png",
            sizeBytes: 3,
            path: "/root/.local/attachments/thread_gateway_stream_routing/gateway.png",
          },
        });
      } finally {
        await Promise.all([closeIfOpen(bootstrapSocket), closeIfOpen(clientSocket)]);
      }
    },
    TestTimeoutMs,
  );

  it(
    "closes PTY stream bindings on connection detach while keeping the bootstrap peer alive",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
        clientSocket = await connectConnectionSocket({ env, sandboxInstanceId });

        const clientStreamId = 41;
        const forwardedOpen = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: clientStreamId,
            channel: {
              kind: "pty",
              session: "create",
              ptySessionId: "terminal",
              cols: 120,
              rows: 40,
            },
          }),
        );
        expect(parseStreamMessage((await forwardedOpen).data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "pty",
            session: "create",
            ptySessionId: "terminal",
            cols: 120,
            rows: 40,
          },
        });

        const forwardedOpenOk = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        expect(parseStreamMessage((await forwardedOpenOk).data)).toEqual({
          type: "stream.open.ok",
          streamId: clientStreamId,
        });

        const forwardedClose = waitForWebSocketMessage(bootstrapSocket);
        await closeWebSocket(clientSocket);
        clientSocket = undefined;

        expect(parseStreamMessage((await forwardedClose).data)).toEqual({
          type: "stream.close",
          streamId: 1,
        });
        await sendWebSocketPingAndExpectPong(
          bootstrapSocket,
          Buffer.from("bootstrap-still-open-after-pty-detach", "utf8"),
        );
      } finally {
        await Promise.all([closeIfOpen(bootstrapSocket), closeIfOpen(clientSocket)]);
      }
    },
    TestTimeoutMs,
  );

  it(
    "routes process stream websocket-text frames in both directions",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
        clientSocket = await connectConnectionSocket({ env, sandboxInstanceId });

        const clientStreamId = 83;
        const forwardedOpen = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: clientStreamId,
            channel: {
              kind: "processes",
            },
          }),
        );
        expect(parseStreamMessage((await forwardedOpen).data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "processes",
          },
        });

        const forwardedOpenOk = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        expect(parseStreamMessage((await forwardedOpenOk).data)).toEqual({
          type: "stream.open.ok",
          streamId: clientStreamId,
        });

        const refreshPayload = JSON.stringify({ type: "processes.refresh" });
        const forwardedRefresh = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          Buffer.from(
            encodeWebSocketTextDataFrame({
              streamId: clientStreamId,
              payload: refreshPayload,
            }),
          ),
        );
        expect(parseDataFrame((await forwardedRefresh).data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: 1,
          payloadKind: PayloadKindWebSocketText,
          payload: new Uint8Array(Buffer.from(refreshPayload, "utf8")),
        });

        const snapshotPayload = JSON.stringify({
          type: "processes.snapshot",
          observedAt: "2026-04-10T12:00:00.000Z",
          processes: [
            {
              pid: 123,
              command: "vite",
              listeners: [
                {
                  port: 5173,
                  bindAddress: "127.0.0.1",
                },
              ],
            },
          ],
        });
        const forwardedSnapshot = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          Buffer.from(
            encodeWebSocketTextDataFrame({
              streamId: 1,
              payload: snapshotPayload,
            }),
          ),
        );
        expect(parseDataFrame((await forwardedSnapshot).data)).toEqual({
          frameKind: DataFrameKindData,
          streamId: clientStreamId,
          payloadKind: PayloadKindWebSocketText,
          payload: new Uint8Array(Buffer.from(snapshotPayload, "utf8")),
        });
      } finally {
        await Promise.all([closeIfOpen(bootstrapSocket), closeIfOpen(clientSocket)]);
      }
    },
    TestTimeoutMs,
  );

  it(
    "releases PTY stream bindings on client close and ignores late exit events",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
        clientSocket = await connectConnectionSocket({ env, sandboxInstanceId });

        await openPtyStream({
          bootstrapSocket,
          clientSocket,
          clientStreamId: 41,
          bootstrapStreamId: 1,
        });

        const forwardedClose = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.close",
            streamId: 41,
          }),
        );
        expect(parseStreamMessage((await forwardedClose).data)).toEqual({
          type: "stream.close",
          streamId: 1,
        });

        const bootstrapNoMessage = waitForNoWebSocketMessage(bootstrapSocket);
        const clientNoMessage = waitForNoWebSocketMessage(clientSocket);
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
        await Promise.all([bootstrapNoMessage, clientNoMessage]);

        await openPtyStream({
          bootstrapSocket,
          clientSocket,
          clientStreamId: 42,
          bootstrapStreamId: 2,
        });
      } finally {
        await Promise.all([closeIfOpen(bootstrapSocket), closeIfOpen(clientSocket)]);
      }
    },
    TestTimeoutMs,
  );
});

async function insertSandboxInstanceRow(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_integration_new_stream_routing",
    sandboxProfileId: "sbp_integration_new_stream_routing",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_integration_new_stream_routing",
    source: "webhook",
  });
}

async function connectBootstrapSocket(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<WebSocket> {
  return await connectSandboxTunnelWebSocket({
    websocketBaseUrl: createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl),
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: "bootstrap",
    token: await mintBootstrapToken({
      config: {
        bootstrapTokenSecret: BootstrapTokenSecret,
        tokenIssuer: BootstrapTokenIssuer,
        tokenAudience: GatewayTokenAudience,
      },
      jti: randomUUID(),
      sandboxInstanceId: input.sandboxInstanceId,
      ttlSeconds: 120,
    }),
    headers: {
      [TestEnvironmentIdHeader]: input.env.id,
    },
  });
}

async function connectConnectionSocket(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<WebSocket> {
  return await connectSandboxTunnelWebSocket({
    websocketBaseUrl: createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl),
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: "connect",
    token: await mintConnectionToken({
      config: {
        connectionTokenSecret: ConnectionTokenSecret,
        tokenIssuer: ConnectionTokenIssuer,
        tokenAudience: GatewayTokenAudience,
      },
      jti: randomUUID(),
      sandboxInstanceId: input.sandboxInstanceId,
      ttlSeconds: 120,
    }),
    headers: {
      [TestEnvironmentIdHeader]: input.env.id,
    },
  });
}

function parseStreamMessage(data: string | Buffer): StreamControlMessage {
  if (typeof data !== "string") {
    throw new Error("Expected websocket message data to be a string.");
  }

  const parsedMessage = parseStreamControlMessage(data);
  if (parsedMessage === undefined) {
    throw new Error("Expected websocket message payload to be a stream control message.");
  }

  return parsedMessage;
}

function parseDataFrame(data: string | Buffer): ReturnType<typeof decodeDataFrame> {
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

async function openPtyStream(input: {
  bootstrapSocket: WebSocket;
  clientSocket: WebSocket;
  clientStreamId: number;
  bootstrapStreamId: number;
}): Promise<void> {
  const forwardedOpen = waitForWebSocketMessage(input.bootstrapSocket);
  await sendWebSocketMessage(
    input.clientSocket,
    JSON.stringify({
      type: "stream.open",
      streamId: input.clientStreamId,
      channel: {
        kind: "pty",
        session: "create",
        ptySessionId: "terminal",
        cols: 120,
        rows: 40,
      },
    }),
  );
  expect(parseStreamMessage((await forwardedOpen).data)).toEqual({
    type: "stream.open",
    streamId: input.bootstrapStreamId,
    channel: {
      kind: "pty",
      session: "create",
      ptySessionId: "terminal",
      cols: 120,
      rows: 40,
    },
  });

  const forwardedOpenOk = waitForWebSocketMessage(input.clientSocket);
  await sendWebSocketMessage(
    input.bootstrapSocket,
    JSON.stringify({
      type: "stream.open.ok",
      streamId: input.bootstrapStreamId,
    }),
  );
  expect(parseStreamMessage((await forwardedOpenOk).data)).toEqual({
    type: "stream.open.ok",
    streamId: input.clientStreamId,
  });
}

async function closeIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}
