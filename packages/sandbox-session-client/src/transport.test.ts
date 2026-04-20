import {
  decodeDataFrame,
  encodeDataFrame,
  MaxStreamWindowBytes,
  parseStreamControlMessage,
  PayloadKindRawBytes,
  PayloadKindWebSocketText,
  type BootstrapControlMessage,
  type PortsControlMessage,
  type StreamChannel,
  type StreamControlMessage,
  type StreamDataFrame,
} from "@mistle/sandbox-session-protocol";
import { systemSleeper } from "@mistle/time";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, type WebSocket as NodeWebSocket, WebSocketServer } from "ws";

import { createNodeSandboxSessionRuntime } from "./node.js";
import { SandboxSessionSocketReadyStates } from "./runtime.js";
import { SandboxSessionTransport } from "./transport.js";

type TestServer = {
  close: () => Promise<void>;
  closeClientSocket: () => void;
  connectionCount: () => number;
  receivedControlMessages: StreamControlMessage[];
  receivedDataFrames: StreamDataFrame[];
  receivedTextMessages: string[];
  sendControlMessage: (message: StreamControlMessage) => void;
  sendDataFrame: (frame: { payload: Uint8Array; payloadKind: number; streamId: number }) => void;
  sendTextMessage: (message: string) => void;
  url: string;
};

const PollIntervalMs = 10;
const openServers = new Set<TestServer>();

function toUint8Array(data: RawData): Uint8Array {
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data);
  }

  return new Uint8Array(Buffer.concat(data));
}

function toText(data: RawData): string {
  return new TextDecoder().decode(toUint8Array(data));
}

async function waitForCondition(input: {
  description: string;
  evaluate: () => boolean;
  timeoutMs: number;
}): Promise<void> {
  const deadlineEpochMs = Date.now() + input.timeoutMs;
  while (Date.now() < deadlineEpochMs) {
    if (input.evaluate()) {
      return;
    }

    await systemSleeper.sleep(PollIntervalMs);
  }

  throw new Error(`Timed out waiting for ${input.description} after ${String(input.timeoutMs)}ms.`);
}

async function startTestServer(input?: {
  rejectChannelKinds?: readonly StreamChannel["kind"][];
}): Promise<TestServer> {
  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error) => reject(error));
  });

  const receivedControlMessages: StreamControlMessage[] = [];
  const receivedDataFrames: StreamDataFrame[] = [];
  const receivedTextMessages: string[] = [];
  const rejectChannelKinds = new Set(input?.rejectChannelKinds ?? []);
  let currentConnectionCount = 0;
  let clientSocket: NodeWebSocket | null = null;

  wsServer.on("connection", (socket) => {
    currentConnectionCount += 1;
    clientSocket = socket;

    socket.on("message", (payload, isBinary) => {
      if (!isBinary) {
        const controlMessage = parseStreamControlMessage(toText(payload));
        if (controlMessage === undefined) {
          receivedTextMessages.push(toText(payload));
          return;
        }

        receivedControlMessages.push(controlMessage);
        if (controlMessage.type === "stream.open") {
          socket.send(
            JSON.stringify({
              type: rejectChannelKinds.has(controlMessage.channel.kind)
                ? "stream.open.error"
                : "stream.open.ok",
              streamId: controlMessage.streamId,
              ...(rejectChannelKinds.has(controlMessage.channel.kind)
                ? {
                    code: "channel_rejected",
                    message: "channel rejected",
                  }
                : {}),
            }),
          );
        }

        return;
      }

      receivedDataFrames.push(decodeDataFrame(toUint8Array(payload)));
    });
  });

  const address = wsServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose a concrete socket address.");
  }

  return {
    close: async (): Promise<void> => {
      clientSocket?.close();
      await new Promise<void>((resolve, reject) => {
        wsServer.close((error) => {
          if (error == null) {
            resolve();
            return;
          }

          reject(error);
        });
      });
    },
    closeClientSocket: (): void => {
      if (clientSocket === null) {
        throw new Error("Expected websocket client to be connected before closing.");
      }

      clientSocket.close();
    },
    connectionCount: (): number => currentConnectionCount,
    receivedControlMessages,
    receivedDataFrames,
    receivedTextMessages,
    sendControlMessage: (message): void => {
      if (clientSocket === null) {
        throw new Error("Expected websocket client to be connected before sending control.");
      }

      clientSocket.send(JSON.stringify(message));
    },
    sendDataFrame: (frame): void => {
      if (clientSocket === null) {
        throw new Error("Expected websocket client to be connected before sending data.");
      }

      clientSocket.send(
        encodeDataFrame({
          streamId: frame.streamId,
          payloadKind: frame.payloadKind,
          payload: frame.payload,
        }),
      );
    },
    sendTextMessage: (message): void => {
      if (clientSocket === null) {
        throw new Error("Expected websocket client to be connected before sending text.");
      }

      clientSocket.send(message);
    },
    url: `ws://127.0.0.1:${String(address.port)}`,
  };
}

async function createManagedTestServer(input?: {
  rejectChannelKinds?: readonly StreamChannel["kind"][];
}): Promise<TestServer> {
  const server = await startTestServer(input);
  openServers.add(server);
  return server;
}

afterEach(async () => {
  await Promise.all(
    [...openServers].map(async (server) => {
      await server.close();
    }),
  );
  openServers.clear();
});

describe("SandboxSessionTransport", () => {
  it("surfaces ports control messages as unhandled control events", async () => {
    const server = await createManagedTestServer();
    const transport = new SandboxSessionTransport({
      runtime: createNodeSandboxSessionRuntime(),
    });
    const unhandledMessages: Array<
      BootstrapControlMessage | PortsControlMessage | StreamControlMessage
    > = [];

    transport.onEvent((event) => {
      if (event.type === "unhandled_control") {
        unhandledMessages.push(event.message);
      }
    });

    await transport.connect({
      connectionUrl: server.url,
    });

    await transport.sendTextMessage(
      JSON.stringify({
        type: "ports.target.authorize",
        requestId: "req_123",
        target: {
          kind: "port",
          port: 5173,
        },
      }),
    );
    server.sendTextMessage(
      JSON.stringify({
        type: "ports.target.authorize.result",
        requestId: "req_123",
        authorized: true,
        upstreamProtocol: "http",
        websocketCapable: true,
      }),
    );

    await waitForCondition({
      description: "ports target authorize result",
      evaluate: () => unhandledMessages.length === 1,
      timeoutMs: 1000,
    });

    expect(server.receivedTextMessages).toEqual([
      JSON.stringify({
        type: "ports.target.authorize",
        requestId: "req_123",
        target: {
          kind: "port",
          port: 5173,
        },
      }),
    ]);
    expect(unhandledMessages[0]).toEqual({
      type: "ports.target.authorize.result",
      requestId: "req_123",
      authorized: true,
      upstreamProtocol: "http",
      websocketCapable: true,
    });
  });

  it("opens multiple logical streams on one websocket transport", async () => {
    const server = await createManagedTestServer();
    const transport = new SandboxSessionTransport({
      runtime: createNodeSandboxSessionRuntime(),
    });

    await transport.connect({
      connectionUrl: server.url,
    });

    const firstStream = await transport.openStream({
      channel: {
        kind: "agent",
      },
    });
    const secondStream = await transport.openStream({
      channel: {
        kind: "pty",
        session: "create",
        ptySessionId: "terminal",
        cols: 80,
        rows: 24,
      },
    });

    expect(transport.readyState).toBe(SandboxSessionSocketReadyStates.OPEN);
    expect(server.connectionCount()).toBe(1);
    expect(firstStream.streamId).toBe(1);
    expect(secondStream.streamId).toBe(2);
    expect(firstStream.state).toBe("open");
    expect(secondStream.state).toBe("open");
  });

  it("routes control and data frames to the owning stream id", async () => {
    const server = await createManagedTestServer();
    const transport = new SandboxSessionTransport({
      runtime: createNodeSandboxSessionRuntime(),
    });
    const firstStreamEvents: string[] = [];
    const secondStreamEvents: string[] = [];

    await transport.connect({
      connectionUrl: server.url,
    });

    const firstStream = await transport.openStream({
      channel: {
        kind: "agent",
      },
    });
    const secondStream = await transport.openStream({
      channel: {
        kind: "pty",
        session: "create",
        ptySessionId: "terminal",
        cols: 80,
        rows: 24,
      },
    });

    firstStream.onEvent((event) => {
      if (event.type === "control") {
        firstStreamEvents.push(`control:${event.message.type}`);
      }
      if (event.type === "data") {
        firstStreamEvents.push(`data:${String(event.frame.streamId)}`);
      }
    });
    secondStream.onEvent((event) => {
      if (event.type === "control") {
        secondStreamEvents.push(`control:${event.message.type}`);
      }
      if (event.type === "data") {
        secondStreamEvents.push(`data:${String(event.frame.streamId)}`);
      }
    });

    const outboundPayload = new TextEncoder().encode("ping");
    await firstStream.sendDataFrame({
      payload: outboundPayload,
      payloadKind: PayloadKindWebSocketText,
    });
    server.sendControlMessage({
      type: "stream.window",
      streamId: firstStream.streamId,
      bytes: outboundPayload.byteLength,
    });
    server.sendDataFrame({
      streamId: secondStream.streamId,
      payloadKind: PayloadKindRawBytes,
      payload: new Uint8Array([1, 2, 3]),
    });

    await systemSleeper.sleep(100);

    expect(firstStreamEvents).toContain("control:stream.window");
    expect(secondStreamEvents).toContain(`data:${String(secondStream.streamId)}`);
    expect(
      server.receivedControlMessages.some((message) => {
        return (
          message.type === "stream.window" &&
          message.streamId === secondStream.streamId &&
          message.bytes === 3
        );
      }),
    ).toBe(true);
  });

  it("allows agent streams to send a large payload when capacity is available", async () => {
    const server = await createManagedTestServer();
    const transport = new SandboxSessionTransport({
      runtime: createNodeSandboxSessionRuntime(),
    });

    await transport.connect({
      connectionUrl: server.url,
    });

    const agentStream = await transport.openStream({
      channel: {
        kind: "agent",
      },
    });
    const payload = new TextEncoder().encode(
      "x".repeat(Math.min(1024 * 1024, MaxStreamWindowBytes - 1024)),
    );

    await expect(
      agentStream.sendDataFrame({
        payload,
        payloadKind: PayloadKindWebSocketText,
      }),
    ).resolves.toBeUndefined();

    await waitForCondition({
      description: "agent frame to reach the server",
      evaluate: () => server.receivedDataFrames.length > 0,
      timeoutMs: 1_000,
    });

    const receivedFrame = server.receivedDataFrames.at(-1);
    expect(receivedFrame?.frameKind).toBe(0x01);
    expect(receivedFrame?.streamId).toBe(agentStream.streamId);
    expect(receivedFrame?.payloadKind).toBe(PayloadKindWebSocketText);
    expect(receivedFrame?.payload.byteLength).toBe(payload.byteLength);
  });

  it("marks every active stream as transport_closed when the websocket closes", async () => {
    const server = await createManagedTestServer();
    const transport = new SandboxSessionTransport({
      runtime: createNodeSandboxSessionRuntime(),
    });
    const firstStates: string[] = [];
    const secondStates: string[] = [];

    await transport.connect({
      connectionUrl: server.url,
    });

    const firstStream = await transport.openStream({
      channel: {
        kind: "agent",
      },
    });
    const secondStream = await transport.openStream({
      channel: {
        kind: "pty",
        session: "create",
        ptySessionId: "terminal",
        cols: 80,
        rows: 24,
      },
    });

    firstStream.onEvent((event) => {
      if (event.type === "state_changed") {
        firstStates.push(event.state);
      }
    });
    secondStream.onEvent((event) => {
      if (event.type === "state_changed") {
        secondStates.push(event.state);
      }
    });

    server.closeClientSocket();

    await waitForCondition({
      description: "transport close fan-out",
      evaluate: () =>
        firstStates.includes("transport_closed") && secondStates.includes("transport_closed"),
      timeoutMs: 1_000,
    });

    expect(firstStream.state).toBe("transport_closed");
    expect(secondStream.state).toBe("transport_closed");
    expect(transport.readyState).toBe(SandboxSessionSocketReadyStates.CLOSED);
  });

  it("drops late events after a stream is disposed", async () => {
    const server = await createManagedTestServer();
    const transport = new SandboxSessionTransport({
      runtime: createNodeSandboxSessionRuntime(),
    });
    const receivedEvents: string[] = [];

    await transport.connect({
      connectionUrl: server.url,
    });

    const stream = await transport.openStream({
      channel: {
        kind: "agent",
      },
    });

    stream.onEvent((event) => {
      if (event.type === "control") {
        receivedEvents.push(event.message.type);
      }
    });

    stream.dispose();

    server.sendControlMessage({
      type: "stream.window",
      streamId: stream.streamId,
      bytes: 5,
    });
    await systemSleeper.sleep(50);

    expect(receivedEvents).toEqual([]);
    expect(() => {
      stream.onEvent(() => {});
    }).toThrow(`Sandbox session stream ${String(stream.streamId)} has been disposed.`);
  });

  it("rejects a stream.open handshake when the server rejects the channel", async () => {
    const server = await createManagedTestServer({
      rejectChannelKinds: ["agent"],
    });
    const transport = new SandboxSessionTransport({
      runtime: createNodeSandboxSessionRuntime(),
    });

    await transport.connect({
      connectionUrl: server.url,
    });

    await expect(
      transport.openStream({
        channel: {
          kind: "agent",
        },
      }),
    ).rejects.toThrow(
      "Sandbox session stream.open request was rejected (channel_rejected): channel rejected",
    );
  });
});
