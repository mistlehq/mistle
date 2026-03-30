import { once } from "node:events";

import {
  PayloadKindRawBytes,
  decodeDataFrame,
  encodeDataFrame,
} from "@mistle/sandbox-session-protocol";
import { describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer, type RawData } from "ws";

import {
  finishActiveTunnelStreamRelay,
  type ActiveTunnelStreamRelay,
  type ActiveTunnelStreamRelayResult,
} from "../src/tunnel/active-relay.js";
import { AsyncQueue } from "../src/tunnel/async-queue.js";
import type { TunnelSocketMessage } from "../src/tunnel/connect-request.js";
import { handlePtyConnectRequest } from "../src/tunnel/pty-channel.js";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

type WebSocketPair = {
  server: WebSocketServer;
  serverSocket: WebSocket;
  clientSocket: WebSocket;
  clientMessages: AsyncQueue<TunnelSocketMessage>;
};

type OpenNamedPtyInput = {
  activePtySessions: Parameters<typeof handlePtyConnectRequest>[0]["activePtySessions"];
  relayResultQueue: AsyncQueue<ActiveTunnelStreamRelayResult>;
  ptySessionId: string;
  signal: AbortSignal;
  streamId: number;
  tunnelSocket: WebSocket;
};

function createPtyStreamOpenPayload(input: { streamId: number; ptySessionId: string }): string {
  return JSON.stringify({
    type: "stream.open",
    streamId: input.streamId,
    channel: {
      kind: "pty",
      session: "create",
      ptySessionId: input.ptySessionId,
      cols: 80,
      rows: 24,
    },
  });
}

function createPtyAttachPayload(input: { streamId: number; ptySessionId: string }): string {
  return JSON.stringify({
    type: "stream.open",
    streamId: input.streamId,
    channel: {
      kind: "pty",
      session: "attach",
      ptySessionId: input.ptySessionId,
      cols: 80,
      rows: 24,
    },
  });
}

function readListeningPort(server: WebSocketServer): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("websocket server address must be available");
  }

  return address.port;
}

function parseTextMessage(message: TunnelSocketMessage): Record<string, unknown> {
  if (message.kind !== "text") {
    throw new Error("expected websocket text message");
  }

  const parsed = JSON.parse(message.payload);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("expected websocket JSON object message");
  }

  return Object.fromEntries(Object.entries(parsed));
}

function rawDataToUint8Array(payload: RawData): Uint8Array {
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }
  if (Array.isArray(payload)) {
    return Uint8Array.from(Buffer.concat(payload));
  }

  return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
}

async function nextQueueItem<T>(
  queue: AsyncQueue<T>,
  signal: AbortSignal,
  label: string,
): Promise<T> {
  try {
    return await queue.next(signal);
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function waitForTextMessage(input: {
  clientMessages: AsyncQueue<TunnelSocketMessage>;
  signal: AbortSignal;
  label: string;
  predicate: (message: Record<string, unknown>) => boolean;
}): Promise<Record<string, unknown>> {
  while (true) {
    const nextMessage = await nextQueueItem(input.clientMessages, input.signal, input.label);
    if (nextMessage.kind !== "text") {
      continue;
    }

    const parsed = parseTextMessage(nextMessage);
    if (input.predicate(parsed)) {
      return parsed;
    }
  }
}

async function createWebSocketPair(): Promise<WebSocketPair> {
  const server = new WebSocketServer({
    port: 0,
  });

  await once(server, "listening");

  const clientMessages = new AsyncQueue<TunnelSocketMessage>();
  const connectionPromise = once(server, "connection").then(([socket]) => {
    if (!(socket instanceof WebSocket)) {
      throw new Error("server connection socket is required");
    }

    return socket;
  });

  const clientSocket = new WebSocket(`ws://127.0.0.1:${String(readListeningPort(server))}`);
  clientSocket.on("message", (payload, isBinary) => {
    if (isBinary) {
      clientMessages.push({
        kind: "binary",
        payload: rawDataToUint8Array(payload),
      });
      return;
    }

    const textPayload =
      typeof payload === "string"
        ? payload
        : new TextDecoder().decode(rawDataToUint8Array(payload));
    clientMessages.push({
      kind: "text",
      payload: textPayload,
    });
  });
  clientSocket.on("error", (error) => {
    clientMessages.fail(error);
  });
  clientSocket.on("close", () => {
    clientMessages.fail(new Error("client websocket closed"));
  });

  await once(clientSocket, "open");
  const serverSocket = await connectionPromise;

  return {
    server,
    serverSocket,
    clientSocket,
    clientMessages,
  };
}

async function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  const closePromise = once(socket, "close");
  socket.close();
  await closePromise;
}

async function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

async function openNamedPty(
  input: OpenNamedPtyInput,
): Promise<Awaited<ReturnType<typeof handlePtyConnectRequest>>> {
  const openResult = await handlePtyConnectRequest({
    signal: input.signal,
    tunnelSocket: input.tunnelSocket,
    rawPayload: createPtyStreamOpenPayload({
      streamId: input.streamId,
      ptySessionId: input.ptySessionId,
    }),
    streamId: input.streamId,
    activePtySessions: input.activePtySessions,
    relayResultQueue: input.relayResultQueue,
  });

  return openResult;
}

async function expectOpenOk(input: {
  clientMessages: AsyncQueue<TunnelSocketMessage>;
  signal: AbortSignal;
  streamId: number;
}): Promise<void> {
  expect(
    await waitForTextMessage({
      clientMessages: input.clientMessages,
      signal: input.signal,
      label: `failed waiting for stream ${String(input.streamId)} open acknowledgement`,
      predicate: (message) =>
        message.type === "stream.open.ok" && message.streamId === input.streamId,
    }),
  ).toEqual({
    type: "stream.open.ok",
    streamId: input.streamId,
  });
}

describe("handlePtyConnectRequest", () => {
  it("emits the PTY exit event only after the final output is sent", async () => {
    const signal = new AbortController();
    const relayResultQueue = new AsyncQueue<ActiveTunnelStreamRelayResult>();
    const marker = "__MISTLE_PTY_EXIT_ORDER__";
    const { server, serverSocket, clientSocket, clientMessages } = await createWebSocketPair();

    try {
      const { relay } = await openNamedPty({
        activePtySessions: new Map(),
        relayResultQueue,
        ptySessionId: "terminal",
        signal: signal.signal,
        streamId: 1,
        tunnelSocket: serverSocket,
      });

      expect(relay).toBeDefined();
      if (relay === undefined) {
        throw new Error("pty relay is required");
      }

      await expectOpenOk({
        clientMessages,
        signal: signal.signal,
        streamId: 1,
      });

      relay.messages.push({
        kind: "binary",
        payload: encodeDataFrame({
          streamId: 1,
          payloadKind: PayloadKindRawBytes,
          payload: textEncoder.encode(`printf '${marker}\\n'; exit 7\n`),
        }),
      });

      const binaryOutputChunks: string[] = [];
      let exitCode: number | undefined;

      while (exitCode === undefined) {
        const nextMessage = await nextQueueItem(
          clientMessages,
          signal.signal,
          "failed waiting for PTY relay output",
        );
        if (nextMessage.kind === "binary") {
          const dataFrame = decodeDataFrame(nextMessage.payload);
          if (dataFrame.streamId !== 1) {
            throw new Error(
              `expected PTY output for stream 1, received ${String(dataFrame.streamId)}`,
            );
          }
          binaryOutputChunks.push(textDecoder.decode(dataFrame.payload, { stream: true }));
          continue;
        }

        const textMessage = parseTextMessage(nextMessage);
        const messageType = typeof textMessage.type === "string" ? textMessage.type : "";
        if (messageType === "stream.window") {
          if (textMessage.streamId !== 1) {
            throw new Error(
              `expected stream.window for stream 1, received ${String(textMessage.streamId)}`,
            );
          }
          continue;
        }

        if (messageType === "stream.event") {
          const event =
            typeof textMessage.event === "object" &&
            textMessage.event !== null &&
            !Array.isArray(textMessage.event)
              ? Object.fromEntries(Object.entries(textMessage.event))
              : undefined;
          if (
            event === undefined ||
            event.type !== "pty.exit" ||
            typeof event.exitCode !== "number"
          ) {
            throw new Error("expected pty exit event message");
          }

          exitCode = event.exitCode;
          continue;
        }
      }

      expect(exitCode).toBe(7);
      expect(binaryOutputChunks.join("")).toContain(marker);

      const relayResult = await nextQueueItem(
        relayResultQueue,
        signal.signal,
        "failed waiting for PTY relay completion",
      );
      expect(relayResult.error).toBeUndefined();
      expect(relayResult.updatesPtySession).toBe(true);
      if (!relayResult.updatesPtySession) {
        throw new Error("expected PTY relay result to update the PTY session");
      }
      expect(relayResult.ptySession).toBeUndefined();
    } finally {
      signal.abort();
      await closeWebSocket(clientSocket).catch(() => undefined);
      await closeWebSocket(serverSocket).catch(() => undefined);
      await closeWebSocketServer(server).catch(() => undefined);
    }
  });

  it("allows opening more than two concurrent named PTY sessions", async () => {
    const signal = new AbortController();
    const relayResultQueue = new AsyncQueue<ActiveTunnelStreamRelayResult>();
    const activePtySessions = new Map();
    const { server, serverSocket, clientSocket, clientMessages } = await createWebSocketPair();

    try {
      const terminalOpen = await openNamedPty({
        activePtySessions,
        relayResultQueue,
        ptySessionId: "terminal",
        signal: signal.signal,
        streamId: 1,
        tunnelSocket: serverSocket,
      });

      expect(terminalOpen.relay).toBeDefined();
      expect(terminalOpen.ptySessions.size).toBe(1);
      expect(terminalOpen.ptySessions.has("terminal")).toBe(true);

      await expectOpenOk({
        clientMessages,
        signal: signal.signal,
        streamId: 1,
      });

      const cliOpen = await openNamedPty({
        activePtySessions: terminalOpen.ptySessions,
        relayResultQueue,
        ptySessionId: "cli",
        signal: signal.signal,
        streamId: 2,
        tunnelSocket: serverSocket,
      });

      expect(cliOpen.relay).toBeDefined();
      expect(cliOpen.ptySessions.size).toBe(2);
      expect(cliOpen.ptySessions.has("terminal")).toBe(true);
      expect(cliOpen.ptySessions.has("cli")).toBe(true);

      await expectOpenOk({
        clientMessages,
        signal: signal.signal,
        streamId: 2,
      });

      const scratchOpen = await openNamedPty({
        activePtySessions: cliOpen.ptySessions,
        relayResultQueue,
        ptySessionId: "scratch",
        signal: signal.signal,
        streamId: 3,
        tunnelSocket: serverSocket,
      });

      expect(scratchOpen.relay).toBeDefined();
      expect(scratchOpen.ptySessions.size).toBe(3);
      expect(scratchOpen.ptySessions.has("terminal")).toBe(true);
      expect(scratchOpen.ptySessions.has("cli")).toBe(true);
      expect(scratchOpen.ptySessions.has("scratch")).toBe(true);

      await expectOpenOk({
        clientMessages,
        signal: signal.signal,
        streamId: 3,
      });
    } finally {
      signal.abort();
      await closeWebSocket(clientSocket).catch(() => undefined);
      await closeWebSocket(serverSocket).catch(() => undefined);
      await closeWebSocketServer(server).catch(() => undefined);
    }
  });

  it("preserves the remaining PTY session after another PTY relay finishes", async () => {
    const signal = new AbortController();
    const relayResultQueue = new AsyncQueue<ActiveTunnelStreamRelayResult>();
    const activePtySessions = new Map();
    const { server, serverSocket, clientSocket, clientMessages } = await createWebSocketPair();

    try {
      const terminalOpen = await openNamedPty({
        activePtySessions,
        relayResultQueue,
        ptySessionId: "terminal",
        signal: signal.signal,
        streamId: 1,
        tunnelSocket: serverSocket,
      });

      await expectOpenOk({
        clientMessages,
        signal: signal.signal,
        streamId: 1,
      });

      const cliOpen = await openNamedPty({
        activePtySessions: terminalOpen.ptySessions,
        relayResultQueue,
        ptySessionId: "cli",
        signal: signal.signal,
        streamId: 2,
        tunnelSocket: serverSocket,
      });

      await expectOpenOk({
        clientMessages,
        signal: signal.signal,
        streamId: 2,
      });

      const cliRelay = cliOpen.relay;
      if (cliRelay === undefined) {
        throw new Error("expected CLI relay to be present");
      }

      cliRelay.messages.push({
        kind: "text",
        payload: JSON.stringify({
          type: "stream.close",
          streamId: 2,
        }),
      });

      const cliExit = await waitForTextMessage({
        clientMessages,
        signal: signal.signal,
        label: "failed waiting for CLI PTY exit event",
        predicate: (message) => {
          return message.type === "stream.event" && message.streamId === 2;
        },
      });
      expect(cliExit.type).toBe("stream.event");
      expect(cliExit.streamId).toBe(2);
      expect(cliExit.event).toMatchObject({
        type: "pty.exit",
      });

      const cliRelayResult = await nextQueueItem(
        relayResultQueue,
        signal.signal,
        "failed waiting for CLI relay completion",
      );

      const remainingState = finishActiveTunnelStreamRelay(
        new Map<number, ActiveTunnelStreamRelay>([
          [1, terminalOpen.relay as ActiveTunnelStreamRelay],
          [2, cliRelay],
        ]),
        new Map<string, ActiveTunnelStreamRelay>([
          ["terminal", terminalOpen.relay as ActiveTunnelStreamRelay],
          ["cli", cliRelay],
        ]),
        cliOpen.ptySessions,
        cliRelayResult,
      );

      const terminalReattach = await handlePtyConnectRequest({
        signal: signal.signal,
        tunnelSocket: serverSocket,
        rawPayload: createPtyAttachPayload({
          streamId: 3,
          ptySessionId: "terminal",
        }),
        streamId: 3,
        activePtySessions: remainingState.activePtySessionsBySessionId,
        relayResultQueue,
      });

      expect(terminalReattach.relay).toBeDefined();
      expect(terminalReattach.ptySessions.has("terminal")).toBe(true);

      await expectOpenOk({
        clientMessages,
        signal: signal.signal,
        streamId: 3,
      });
    } finally {
      signal.abort();
      await closeWebSocket(clientSocket).catch(() => undefined);
      await closeWebSocket(serverSocket).catch(() => undefined);
      await closeWebSocketServer(server).catch(() => undefined);
    }
  });
});
